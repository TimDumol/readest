package com.readest.native_bridge

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import com.ichi2.anki.FlashCardsContract
import com.ichi2.anki.api.AddContentApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Small, deliberately boring boundary around the published AnkiDroid API.
 * ContentResolver work is always called from an IO dispatcher by the plugin.
 */
class AnkiDroidAdapter(private val activity: Activity) {
    companion object {
        const val PACKAGE_NAME = "com.ichi2.anki"
        const val REQUEST_PERMISSION = 17041
        private const val FIELD_SEPARATOR = "\u001f"
        private val STUDY_MODEL_NAME_PATTERN = Regex("^Readest Language v[1-9][0-9]*$")
    }

    private val context: Context = activity.applicationContext
    private val permission = AddContentApi.READ_WRITE_PERMISSION

    private fun installed(): Boolean = try {
        context.packageManager.getPackageInfo(PACKAGE_NAME, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    private fun apiAvailable(): Boolean = try {
        AddContentApi.getAnkiDroidPackageName(context) != null
    } catch (_: Exception) {
        false
    }

    fun status(): JSObject = JSObject().apply {
        val isInstalled = installed()
        val available = isInstalled && apiAvailable()
        put("supported", true)
        put("installed", isInstalled)
        put("apiAvailable", available)
        put("permission", when {
            !available -> "unavailable"
            ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED -> "granted"
            else -> "denied"
        })
    }

    fun requestPermission(): JSObject {
        val result = JSObject()
        if (ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) {
            result.put("result", "granted")
            return result
        }
        if (!apiAvailable()) {
            result.put("result", "unavailable")
            return result
        }
        ActivityCompat.requestPermissions(activity, arrayOf(permission), REQUEST_PERMISSION)
        // Android delivers the final answer to the Activity. Return a prompt
        // state now; the caller can query status after the user acts.
        result.put("result", "requested")
        return result
    }

    suspend fun listDecks(): JSObject = withContext(Dispatchers.IO) {
        val api = requireApi()
        val decks = JSArray()
        api.deckList?.entries?.sortedBy { it.value }?.forEach { (id, name) ->
            if (id > 0 && !name.isNullOrBlank()) {
                decks.put(JSObject().apply { put("id", id.toString()); put("name", name) })
            }
        }
        JSObject().apply { put("decks", decks) }
    }

    suspend fun listModels(): JSObject = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val models = JSArray()
        val cursor = resolver.query(FlashCardsContract.Model.CONTENT_URI, null, null, null, null)
            ?: throw IllegalStateException("AnkiDroid collection is unavailable")
        cursor.use {
            while (it.moveToNext()) {
                val id = it.longValue(FlashCardsContract.Model._ID) ?: continue
                val name = it.stringValue(FlashCardsContract.Model.NAME) ?: continue
                val fields = it.stringValue(FlashCardsContract.Model.FIELD_NAMES)
                    ?.split(FIELD_SEPARATOR)
                    ?.filter { field -> field.isNotEmpty() }
                    ?: emptyList()
                val type = it.intValue(FlashCardsContract.Model.TYPE) ?: 0
                val templates = JSArray()
                val templateUri = Uri.withAppendedPath(
                    Uri.withAppendedPath(FlashCardsContract.Model.CONTENT_URI, id.toString()),
                    "templates",
                )
                resolver.query(templateUri, null, null, null, null)?.use { templateCursor ->
                    while (templateCursor.moveToNext()) {
                        templates.put(JSObject().apply {
                            put("name", templateCursor.stringValue("card_template_name") ?: "")
                            put("question", templateCursor.stringValue("question_format") ?: "")
                            put("answer", templateCursor.stringValue("answer_format") ?: "")
                        })
                    }
                }
                models.put(JSObject().apply {
                    put("id", id.toString())
                    put("name", name)
                    put("type", type)
                    put("fieldNames", JSArray().apply { fields.forEach { put(it) } })
                    put("clozeTemplates", templates)
                })
            }
        }
        JSObject().apply { put("models", models) }
    }

    suspend fun checkDuplicate(modelId: String, firstField: String): JSObject = withContext(Dispatchers.IO) {
        val model = modelId.toLongOrNull() ?: throw IllegalArgumentException("Invalid AnkiDroid model ID")
        val api = requireApi()
        val duplicates = api.findDuplicateNotes(model, firstField)
        JSObject().apply { put("duplicate", duplicates.isNotEmpty()) }
    }

    suspend fun ensureStudyModel(
        name: String, fields: List<String>, cards: List<String>,
        questions: List<String>, answers: List<String>, css: String,
    ): JSObject = withContext(Dispatchers.IO) {
        require(STUDY_MODEL_NAME_PATTERN.matches(name) && fields.firstOrNull() == "LookupId") {
            "Invalid Readest study model"
        }
        require(fields.size == fields.distinct().size && fields.all { it.isNotBlank() })
        require(cards.isNotEmpty() && questions.size == cards.size && answers.size == cards.size)
        val api = requireApi()
        val existing = api.modelList?.entries?.firstOrNull { it.value == name }?.key
        val modelId = if (existing != null) {
            // Never replace user-edited templates or silently reuse an incompatible schema.
            val existingFields = api.getFieldList(existing)?.toList().orEmpty()
            require(existingFields.firstOrNull() == "LookupId" && existingFields.containsAll(fields)) {
                "The existing Readest note type has incompatible fields. Rename it in AnkiDroid before creating a new one."
            }
            existing
        } else {
            api.addNewCustomModel(name, fields.toTypedArray(), cards.toTypedArray(),
                questions.toTypedArray(), answers.toTypedArray(), css, null, 3)
                ?: throw IllegalStateException("AnkiDroid did not return a model ID. Refresh before retrying.")
        }
        JSObject().apply { put("modelId", modelId.toString()) }
    }

    suspend fun addNote(modelId: String, deckId: String, fields: List<String>, tags: List<String>): JSObject = withContext(Dispatchers.IO) {
        try {
            val mid = modelId.toLongOrNull() ?: throw IllegalArgumentException("Invalid AnkiDroid model ID")
            val did = deckId.toLongOrNull() ?: throw IllegalArgumentException("Invalid AnkiDroid deck ID")
            if (fields.isEmpty()) throw IllegalArgumentException("At least one AnkiDroid field is required")
            val api = requireApi()
            validateNoteTarget(api, mid, did, fields)
            val noteId = api.addNote(mid, did, fields.toTypedArray(), tags.toSet())
            if (noteId == null) {
                JSObject().apply {
                    put("status", "uncertain")
                    put("error", "AnkiDroid did not return a note ID; the note may have been added")
                }
            } else {
                JSObject().apply { put("status", "success"); put("noteId", noteId.toString()) }
            }
        } catch (error: SecurityException) {
            JSObject().apply { put("status", "definite_failure"); put("error", "AnkiDroid permission was denied or revoked") }
        } catch (error: IllegalArgumentException) {
            JSObject().apply { put("status", "definite_failure"); put("error", error.message ?: "Invalid AnkiDroid note") }
        } catch (error: IllegalStateException) {
            JSObject().apply { put("status", "definite_failure"); put("error", error.message ?: "AnkiDroid collection is unavailable") }
        } catch (error: Exception) {
            JSObject().apply { put("status", "uncertain"); put("error", "The note may have been added: ${error.message}") }
        }
    }

    private fun validateNoteTarget(api: AddContentApi, modelId: Long, deckId: Long, fields: List<String>) {
        if (api.deckList?.containsKey(deckId) != true) {
            throw IllegalArgumentException("The selected AnkiDroid deck no longer exists")
        }
        val modelUri = Uri.withAppendedPath(FlashCardsContract.Model.CONTENT_URI, modelId.toString())
        val cursor = context.contentResolver.query(modelUri, null, null, null, null)
            ?: throw IllegalArgumentException("The selected AnkiDroid model no longer exists")
        cursor.use {
            if (!it.moveToFirst()) throw IllegalArgumentException("The selected AnkiDroid model no longer exists")
            val type = it.intValue(FlashCardsContract.Model.TYPE) ?: 0
            if (type != 0 && type != 1) throw IllegalArgumentException("Unsupported AnkiDroid note type")
            val fieldNames = it.stringValue(FlashCardsContract.Model.FIELD_NAMES)
                ?.split(FIELD_SEPARATOR)
                ?.filter { field -> field.isNotEmpty() }
                ?: emptyList()
            if (fieldNames.size != fields.size) {
                throw IllegalArgumentException("The selected AnkiDroid model field count changed; choose the destination again")
            }
        }
    }

    private fun requireApi(): AddContentApi {
        if (!apiAvailable()) throw IllegalStateException("AnkiDroid is not installed or its API is disabled")
        if (ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("AnkiDroid permission is not granted")
        }
        return AddContentApi(context)
    }
}

private fun android.database.Cursor.stringValue(name: String): String? {
    val index = getColumnIndex(name)
    return if (index >= 0 && !isNull(index)) getString(index) else null
}

private fun android.database.Cursor.longValue(name: String): Long? {
    val index = getColumnIndex(name)
    return if (index >= 0 && !isNull(index)) getLong(index) else null
}

private fun android.database.Cursor.intValue(name: String): Int? {
    val index = getColumnIndex(name)
    return if (index >= 0 && !isNull(index)) getInt(index) else null
}
