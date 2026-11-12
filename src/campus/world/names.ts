// How names are shortened for display. Rooms the map has are "仙林/教4-309", others "三牌楼:教学主楼301"; floors are "仙林/教4/3".
const SHORT: Record<string, string> = {
    '习近平新时代中国特色社会主义思想概论': '习概', '毛泽东思想和中国特色社会主义理论体系概论': '毛概',
    '马克思主义基本原理': '马原', '思想道德与法治': '思修', '中国近现代史纲要': '近代史', '形势与政策': '形策',
    '计算机通信与网络': '计网', '计算机组成原理': '组成原理', '操作系统基础': '操作系统', '计算机图形学': '图形学',
    '信息安全技术': '信息安全', '单片机原理及系统设计': '单片机', '嵌入式手机终端开发技术': '嵌入式开发',
};
export const courseName = (name: string) => name.replace(/[（(].*?[)）]/g, '').trim() || name.trim();
export const courseShort = (name: string) => SHORT[courseName(name)] ?? courseName(name);
/** A slash means the map has it. */
export const unplaced = (room: string | null | undefined) => !room || !room.includes('/');
/** A room in the teaching office's list, on the map or not; anything else is only a written place. */
export const isRoom = (room: string | null | undefined) => Boolean(room) && /[/:]/.test(room!);
export const roomLabel = (room: string | null | undefined) => (room ?? '').replace(/^[^/:]*[/:]/, '').replaceAll('/', ' ');
export const roomShort = (room: string | null | undefined) => roomLabel(room).replace(/^教/, '');
/** Tight tiles keep the building and the first room; the detail keeps every room. */
export const compactPlace = (place: string) => place.replace(/\d+(?:\/\d+){2,}/g, rooms => `${rooms.split('/')[0]}等${rooms.split('/').length}间`);
/** The building of a room id; the id itself when it is not a room. */
export const buildingOf = (id: string) => {
    const slash = id.indexOf('/');
    if (slash < 0) return id;
    const rest = id.slice(slash + 1);
    const cut = rest.search(/[-/]/);
    return cut < 0 ? id : id.slice(0, slash + 1 + cut);
};
