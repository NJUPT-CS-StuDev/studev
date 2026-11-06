// How names are shortened for display. Rooms are "仙林/教4-309"; floors are "仙林/教4/3".
const SHORT: Record<string, string> = {
    '习近平新时代中国特色社会主义思想概论': '习概', '毛泽东思想和中国特色社会主义理论体系概论': '毛概',
    '马克思主义基本原理': '马原', '思想道德与法治': '思修', '中国近现代史纲要': '近代史', '形势与政策': '形策',
    '计算机通信与网络': '计网', '计算机组成原理': '组成原理', '操作系统基础': '操作系统', '计算机图形学': '图形学',
    '信息安全技术': '信息安全', '单片机原理及系统设计': '单片机', '嵌入式手机终端开发技术': '嵌入式开发',
};
export const courseName = (name: string) => name.replace(/[（(].*?[)）]/g, '').trim() || name.trim();
export const courseShort = (name: string) => SHORT[courseName(name)] ?? courseName(name);
export const unplaced = (room: string | null | undefined) => !room || !room.includes('/');
export const roomLabel = (room: string | null | undefined) => (room ?? '').replace(/^[^/]*\//, '').replaceAll('/', ' ');
export const roomShort = (room: string | null | undefined) => roomLabel(room).replace(/^教/, '');
/** The building of a room id; the id itself when it is not a room. */
export const buildingOf = (id: string) => {
    const slash = id.indexOf('/');
    if (slash < 0) return id;
    const rest = id.slice(slash + 1);
    const cut = rest.search(/[-/]/);
    return cut < 0 ? id : id.slice(0, slash + 1 + cut);
};
