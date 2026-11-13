package top.hicancan.studev.ai

import kotlinx.serialization.json.*

/**
 * A conversation as a tree, as src/campus/ai/thread.ts: a question changed, or an answer asked again, grows a new branch
 * beside the old one instead of replacing it, and one goes back and forth between them. What is shown, and what the
 * model is given, is the path the chosen branches make from the start.
 */
data class ChatNode(val id: String, val parent: String, val message: JsonObject)

data class ChatThread(val nodes: List<ChatNode> = emptyList(), val chosen: Map<String, String> = emptyMap()) {
    /** What follows a message, oldest first. */
    fun children(parent: String) = nodes.filter { it.parent == parent }

    /** The conversation as shown: from the start, at each fork the branch chosen, else the newest. */
    fun path(): List<ChatNode> {
        val out = mutableListOf<ChatNode>()
        var at = START
        while (true) {
            val next = children(at)
            if (next.isEmpty()) return out
            val pick = next.firstOrNull { it.id == chosen[at] } ?: next.last()
            out += pick
            at = pick.id
        }
    }

    /** The last message shown, which the next one follows. */
    fun tip() = path().lastOrNull()?.id ?: START

    /** A message and everything before it, oldest first: what the model is given when answering after it. */
    fun lineage(id: String): List<ChatNode> {
        val byId = nodes.associateBy { it.id }
        return generateSequence(byId[id]) { byId[it.parent] }.toList().asReversed()
    }

    /** A message said after [parent], and its branch chosen there. */
    fun append(parent: String, id: String, message: JsonObject) = ChatThread(nodes + ChatNode(id, parent, message), chosen + (parent to id))

    /** A branch chosen at its fork. */
    fun choose(id: String) = nodes.firstOrNull { it.id == id }?.let { copy(chosen = chosen + (it.parent to id)) } ?: this

    /** Where a message stands among those beside it: the n-th of how many, and the ones before and after. */
    fun siblings(id: String): Siblings {
        val all = nodes.firstOrNull { it.id == id }?.let { children(it.parent) }.orEmpty()
        val index = all.indexOfFirst { it.id == id }
        return Siblings(index, all.size, all.getOrNull(index - 1)?.id, all.getOrNull(index + 1)?.id)
    }

    fun toJson() = buildJsonObject {
        put("nodes", JsonArray(nodes.map { node -> buildJsonObject { put("id", node.id); put("parent", node.parent); put("message", node.message) } }))
        put("chosen", JsonObject(chosen.mapValues { JsonPrimitive(it.value) }))
    }

    data class Siblings(val index: Int, val count: Int, val previous: String?, val next: String?)

    companion object {
        const val START = ""
        fun of(json: JsonObject) = ChatThread(
            json.getValue("nodes").jsonArray.map { it.jsonObject }.map { ChatNode(it.getValue("id").jsonPrimitive.content, it.getValue("parent").jsonPrimitive.content, it.getValue("message").jsonObject) },
            json["chosen"]?.jsonObject.orEmpty().mapValues { it.value.jsonPrimitive.content })
        /** Messages said one after another, as a thread without forks. */
        fun chain(messages: List<JsonObject>, ids: List<String>) = messages.foldIndexed(ChatThread()) { at, thread, message -> thread.append(if (at == 0) START else ids[at - 1], ids[at], message) }
    }
}
