package top.hicancan.studev.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.MoreHoriz
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

@Composable internal fun ChatDrawer(
    chats: List<SavedChat>, projects: List<ChatProject>, suggestions: List<CourseProject>, activeChat: String?, activeProject: String?, busy: Boolean, memory: Memory,
    openChat: (String) -> Unit, newChat: (String?) -> Unit, openProject: (String) -> Unit,
    saveProject: (ChatProject?, String, String?) -> ChatProject, editInstructions: (ChatProject) -> Unit,
    rename: (SavedChat) -> Unit, remove: (SavedChat) -> Unit, move: (Set<String>) -> Unit, mind: () -> Unit, configureTools: () -> Unit, configureModels: () -> Unit,
) {
    var view by remember(activeProject) { mutableStateOf(if (activeProject == null) "chats" else "projects") }
    var projectId by remember(activeProject) { mutableStateOf(activeProject) }
    val project = projects.firstOrNull { it.id == projectId }
    val projectList = view == "projects" && project == null
    val shown = chats.filter { it.projectId == project?.id }
    var marked by remember(view, projectId) { mutableStateOf<Set<String>?>(null) }
    var naming by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf<ChatProject?>(null) }

    if (naming) {
        var name by remember { mutableStateOf(renaming?.name.orEmpty()) }
        AlertDialog(onDismissRequest = { naming = false }, title = { Text(if (renaming == null) "新建项目" else "重命名项目") },
            text = { OutlinedTextField(name, { name = it.take(60) }, label = { Text("项目名称") }, singleLine = true) },
            confirmButton = { TextButton({
                val project = saveProject(renaming, name.trim(), null)
                if (renaming == null) openProject(project.id)
                naming = false
            }, enabled = name.isNotBlank()) { Text(if (renaming == null) "创建" else "保存") } },
            dismissButton = { TextButton({ naming = false }) { Text("取消") } })
    }

    Column(Modifier.fillMaxHeight().statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp)) {
        Choice(listOf("chats" to "普通对话", "projects" to "项目"), view) {
            view = it
            projectId = null
        }
        if (projectList) {
            TextAction("新建项目", { renaming = null; naming = true }, enabled = !busy)
            val assigned = projects.mapNotNullTo(mutableSetOf()) { it.course }
            val offered = suggestions.filterNot { it.code in assigned }
            LazyColumn(Modifier.weight(1f)) {
                items(projects, key = { it.id }) { item -> KeyRow(null, item.name, chevron = true, onClick = if (busy) null else { { openProject(item.id) } }) }
                if (offered.isNotEmpty()) item { Plain("我的课程", 12.sp, Ink.faint, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)) }
                items(offered, key = { "course:${it.code}" }) { suggestion ->
                    KeyRow(null, suggestion.name, chevron = true, onClick = if (busy) null else { { openProject(saveProject(null, suggestion.name, suggestion.code).id) } })
                }
            }
        } else {
            if (project != null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    TextAction("返回项目", { projectId = null }, muted = true)
                    if (project.course == null) TextAction("项目指令", { editInstructions(project) }, enabled = !busy)
                }
                KeyRow(null, project.name, trailing = {
                    TextAction("重命名", { renaming = project; naming = true }, enabled = !busy)
                })
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                if (marked == null) {
                    TextAction("新对话", { newChat(project?.id) }, enabled = !busy)
                    if (shown.isNotEmpty()) TextAction("多选", { marked = emptySet() }, enabled = !busy)
                } else {
                    TextAction("取消", { marked = null })
                    val selected = marked.orEmpty()
                    TextAction("移动（${selected.size}）", { move(selected); marked = null }, enabled = selected.isNotEmpty() && !busy)
                }
            }
            LazyColumn(Modifier.weight(1f)) {
                for ((name, group) in Chats.groups(shown, System.currentTimeMillis())) {
                    item(key = "date:$name") { Plain(name, 12.sp, Ink.faint, modifier = Modifier.padding(start = 8.dp, top = 12.dp, bottom = 4.dp)) }
                    items(group, key = { it.id }) { chat ->
                        var more by remember { mutableStateOf(false) }
                        val selection = marked
                        val on = chat.id == activeChat
                        val shape = RoundedCornerShape(10.dp)
                        val toggle = { if (selection != null) marked = if (chat.id in selection) selection - chat.id else selection + chat.id }
                        Row(Modifier.fillMaxWidth().clip(shape).background(if (on) Ink.sunken else Color.Transparent)
                            .clickable(enabled = !busy) { if (selection == null) openChat(chat.id) else toggle() }.padding(start = 8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            if (selection != null) Checkbox(chat.id in selection, { toggle() }, enabled = !busy)
                            Plain(Chats.titleOf(chat.title, chat.thread), 14.5.sp, maxLines = 1, modifier = Modifier.weight(1f).padding(vertical = 10.dp))
                            if (selection == null) Box {
                                IconButton({ more = true }, Modifier.size(38.dp), enabled = !busy) { Icon(Icons.Outlined.MoreHoriz, "更多", Modifier.size(18.dp), tint = Ink.muted) }
                                DropdownMenu(more, { more = false }, containerColor = Ink.paper) {
                                    DropdownMenuItem({ Text("重命名") }, { more = false; rename(chat) })
                                    DropdownMenuItem({ Text("移动到") }, { more = false; move(setOf(chat.id)) })
                                    DropdownMenuItem({ Text("删除", color = marks().danger) }, { more = false; remove(chat) })
                                }
                            }
                        }
                    }
                }
                if (shown.isEmpty()) item { Plain("这里还没有对话。", 13.sp, Ink.faint, modifier = Modifier.padding(10.dp)) }
            }
        }
        HorizontalDivider(color = Ink.line)
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            DrawerTool(Icons.Outlined.BookmarkBorder, if (activeProject == null) "记忆" else "项目记忆", mind)
            DrawerTool(Icons.Outlined.AutoAwesome, "模型", configureModels)
            DrawerTool(Icons.Outlined.Build, "工具", configureTools)
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


/** One of the three ways into what shapes the AI, as the web's sidebar footer: icon over word, a whole tile to tap. */
@Composable private fun RowScope.DrawerTool(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Icon(icon, null, Modifier.size(20.dp), tint = Ink.muted)
        Plain(label, 12.5.sp, Ink.muted)
    }
}
