package top.hicancan.studev.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import top.hicancan.studev.app.*

internal data class CourseProject(val code: String, val name: String)

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun ChatDrawer(
    chats: List<SavedChat>, projects: List<ChatProject>, suggestions: List<CourseProject>, activeChat: String?, activeProject: String?, busy: Boolean,
    openChat: (String) -> Unit, newChat: (String?) -> Unit, openProject: (String) -> Unit,
    saveProject: (ChatProject?, String, String?) -> ChatProject, editInstructions: (ChatProject) -> Unit,
    rename: (SavedChat) -> Unit, updateChat: (SavedChat) -> Unit, remove: (SavedChat) -> Unit, move: (Set<String>) -> Unit, mind: () -> Unit,
) {
    // One list, as on the web: projects on top, each opening in place over its own chats, then the recent chats.
    var open by remember(activeProject) { mutableStateOf(setOfNotNull(activeProject)) }
    var projectsShown by remember { mutableStateOf(true) }
    var marked by remember { mutableStateOf<Set<String>?>(null) }
    var naming by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<ChatProject?>(null) }
    var historyQuery by remember { mutableStateOf("") }
    var archived by remember { mutableStateOf(false) }
    var historyMenu by remember { mutableStateOf(false) }
    val query = historyQuery.trim()
    val matches = chats.filter { it.archived == archived && Chats.titleOf(it.title, it.thread).contains(query, ignoreCase = true) }
    val recent = matches.filter { archived || it.projectId == null }
    val visibleProjects = projects.filter { project -> project.name.contains(query, ignoreCase = true) || matches.any { it.projectId == project.id } }
    val pinned = recent.filter { it.pinned }.sortedByDescending { it.updated }

    if (naming) {
        var name by remember { mutableStateOf(renaming?.name.orEmpty()) }
        val assigned = projects.mapNotNullTo(mutableSetOf()) { it.course }
        val offered = suggestions.filterNot { it.code in assigned }
        AlertDialog(onDismissRequest = { naming = false }, title = { Text(if (renaming == null) "新建项目" else "重命名项目") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(name, { name = it.take(60) }, label = { Text("项目名称") }, singleLine = true)
                if (renaming == null && offered.isNotEmpty()) {
                    Plain("从本学期课程开始", 12.sp, Ink.faint)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        offered.forEach { course -> Chip(course.name, { naming = false; openProject(saveProject(null, course.name, course.code).id) }) }
                    }
                }
            } },
            confirmButton = { TextButton({
                val project = saveProject(renaming, name.trim(), null)
                if (renaming == null) openProject(project.id)
                naming = false
            }, enabled = name.isNotBlank()) { Text(if (renaming == null) "创建" else "保存") } },
            dismissButton = { TextButton({ naming = false }) { Text("取消") } })
    }

    @Composable fun ChatRow(chat: SavedChat, indent: Boolean) {
        var more by remember { mutableStateOf(false) }
        val selection = marked
        val on = chat.id == activeChat
        val toggle = { if (selection != null) marked = if (chat.id in selection) selection - chat.id else selection + chat.id }
        Row(Modifier.fillMaxWidth().padding(start = if (indent) 18.dp else 0.dp).clip(RoundedCornerShape(10.dp)).background(if (on) Ink.sunken else Color.Transparent)
            .clickable(enabled = !busy) { if (selection == null) openChat(chat.id) else toggle() }.padding(start = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (selection != null) Checkbox(chat.id in selection, { toggle() }, enabled = !busy)
            Plain(Chats.titleOf(chat.title, chat.thread), 14.5.sp, maxLines = 1, modifier = Modifier.weight(1f).padding(vertical = 10.dp))
            if (selection == null) Box {
                IconButton({ more = true }, Modifier.size(38.dp), enabled = !busy) { Icon(Icons.Outlined.MoreHoriz, "更多", Modifier.size(18.dp), tint = Ink.muted) }
                DropdownMenu(more, { more = false }, containerColor = Ink.paper) {
                    DropdownMenuItem({ Text("重命名") }, { more = false; rename(chat) })
                    DropdownMenuItem({ Text(if (chat.pinned) "取消置顶" else "置顶") }, { more = false; updateChat(chat.copy(pinned = !chat.pinned)) })
                    DropdownMenuItem({ Text(if (chat.archived) "取消归档" else "归档") }, { more = false; updateChat(chat.copy(archived = !chat.archived)) })
                    DropdownMenuItem({ Text(if (chat.projectId == null) "移至项目" else "移至其他项目或移出") }, { more = false; move(setOf(chat.id)) })
                    DropdownMenuItem({ Text("删除", color = marks().danger) }, { more = false; remove(chat) })
                }
            }
        }
    }

    Column(Modifier.fillMaxHeight().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            if (marked == null) {
                TextButton(onClick = { newChat(null) }, enabled = !busy) {
                    Icon(Icons.Outlined.EditNote, null, Modifier.size(19.dp), tint = Ink.brand)
                    Spacer(Modifier.width(5.dp)); Plain("新对话", 14.sp, Ink.brand, FontWeight.SemiBold)
                }
                Box {
                    IconButton(onClick = { historyMenu = true }, enabled = !busy) { Icon(Icons.Outlined.MoreHoriz, "更多对话操作", tint = Ink.muted) }
                    DropdownMenu(historyMenu, { historyMenu = false }, containerColor = Ink.paper) {
                        DropdownMenuItem({ Text(if (archived) "返回最近对话" else "查看归档") }, { historyMenu = false; archived = !archived })
                        if (!archived && matches.isNotEmpty()) DropdownMenuItem({ Text("多选对话") }, { historyMenu = false; marked = emptySet() })
                    }
                }
            } else {
                TextAction("取消", { marked = null })
                val selected = marked.orEmpty()
                TextAction("移动（${selected.size}）", { move(selected); marked = null }, enabled = selected.isNotEmpty() && !busy)
            }
        }
        OutlinedTextField(historyQuery, { historyQuery = it }, Modifier.fillMaxWidth().padding(bottom = 7.dp),
            placeholder = { Text("搜索对话") }, leadingIcon = { Icon(Icons.Outlined.Search, null, Modifier.size(18.dp), tint = Ink.muted) },
            singleLine = true, shape = RoundedCornerShape(22.dp), textStyle = androidx.compose.ui.text.TextStyle(fontSize = 14.sp, color = Ink.text))
        LazyColumn(Modifier.weight(1f)) {
            if (!archived) item(key = "projects") {
                Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.clickable { projectsShown = !projectsShown }.padding(start = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Plain("项目", 12.sp, Ink.faint)
                        Icon(if (projectsShown) Icons.Outlined.KeyboardArrowDown else Icons.Outlined.ChevronRight, null, Modifier.size(14.dp), tint = Ink.faint)
                    }
                    TextAction("新建", { renaming = null; naming = true }, enabled = !busy, muted = true)
                }
            }
            if (projectsShown && !archived) for (project in visibleProjects) {
                val inside = matches.filter { it.projectId == project.id }.sortedWith(compareByDescending<SavedChat> { it.pinned }.thenByDescending { it.updated })
                val expanded = project.id in open || query.isNotEmpty() && inside.isNotEmpty()
                item(key = "project:${project.id}") {
                    var more by remember { mutableStateOf(false) }
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (project.id == activeProject) Ink.sunken else Color.Transparent)
                        .clickable(enabled = !busy) { open = if (expanded) open - project.id else open + project.id }.padding(start = 8.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (expanded) Icons.Outlined.FolderOpen else Icons.Outlined.Folder, null, Modifier.size(18.dp), tint = Ink.muted)
                        Plain(project.name, 14.5.sp, maxLines = 1, modifier = Modifier.weight(1f).padding(horizontal = 8.dp, vertical = 10.dp))
                        Box {
                            IconButton({ more = true }, Modifier.size(38.dp), enabled = !busy) { Icon(Icons.Outlined.MoreHoriz, "项目选项", Modifier.size(18.dp), tint = Ink.muted) }
                            DropdownMenu(more, { more = false }, containerColor = Ink.paper) {
                                DropdownMenuItem({ Text("在此项目中新建对话") }, { more = false; newChat(project.id) })
                                DropdownMenuItem({ Text("重命名") }, { more = false; renaming = project; naming = true })
                                if (project.course == null) DropdownMenuItem({ Text("项目指令") }, { more = false; editInstructions(project) })
                            }
                        }
                    }
                }
                if (expanded) {
                    items(inside, key = { "in:${it.id}" }) { chat -> ChatRow(chat, indent = true) }
                    if (inside.isEmpty()) item(key = "empty:${project.id}") { Plain("还没有对话", 13.sp, Ink.faint, modifier = Modifier.padding(start = 26.dp, top = 6.dp, bottom = 6.dp)) }
                }
            }
            if (pinned.isNotEmpty()) {
                item(key = "pinned") { Plain("置顶", 12.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp, top = 12.dp, bottom = 4.dp)) }
                items(pinned, key = { it.id }) { chat -> ChatRow(chat, indent = false) }
            }
            item(key = "recent") { Plain(if (archived) "已归档" else "最近", 12.sp, Ink.muted, FontWeight.SemiBold, modifier = Modifier.padding(start = 8.dp, top = 12.dp, bottom = 4.dp)) }
            for ((name, group) in Chats.groups(recent.filterNot { it.pinned }, System.currentTimeMillis())) {
                item(key = "date:$name") { Plain(name, 12.sp, Ink.faint, modifier = Modifier.padding(start = 8.dp, top = 12.dp, bottom = 4.dp)) }
                items(group, key = { it.id }) { chat -> ChatRow(chat, indent = false) }
            }
            if (recent.isEmpty()) item { Plain(if (query.isNotEmpty()) "没有找到对话" else if (archived) "暂无归档对话" else "暂无对话", 13.sp, Ink.faint, modifier = Modifier.padding(10.dp)) }
        }
        HorizontalDivider(color = Ink.line)
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp).clip(RoundedCornerShape(8.dp))
            .clickable(onClick = mind).heightIn(min = 44.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.BookmarkBorder, null, Modifier.size(17.dp), tint = Ink.muted)
            Plain(if (activeProject == null) "记忆" else "项目记忆", 13.sp, Ink.muted)
        }
    }
}

@Composable internal fun MoveChatsSheet(chats: List<SavedChat>, projects: List<ChatProject>, onClose: () -> Unit, move: (String?) -> Unit) {
    PlainSheet(if (chats.size == 1) "移动对话" else "移动 ${chats.size} 条对话", onClose) {
        val targets = projects.filter { project -> chats.any { it.projectId != project.id } }
        LazyColumn(Modifier.heightIn(max = 380.dp)) {
            if (chats.any { it.projectId != null }) item { KeyRow(null, "普通对话", chevron = true, onClick = { move(null) }) }
            items(targets, key = { it.id }) { project -> KeyRow(null, project.name, chevron = true, onClick = { move(project.id) }) }
            if (targets.isEmpty() && chats.all { it.projectId == null }) item { Plain("先创建一个项目。", 13.sp, Ink.muted) }
        }
    }
}
