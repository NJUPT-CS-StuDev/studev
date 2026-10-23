export const SUPPORTED_ROSTER_TERMS = new Set(['2026-2027']);

export const DEPARTMENTS_2026_2027 = [
  '主席团与统筹',
  '运营支持部',
  '易班建设部',
  '媒体宣传部',
  '心理工作部',
];

export const ROSTER_SEED_2026_2027 = [
  {
    order: 1,
    term: '2026-2027',
    department: '主席团与统筹',
    realName: '吴双灿',
    studentId: 'B24040213',
    qq: '2366522877',
    title: '学生发展中心主席 · StuDev 发起人',
    signature: '在薛定谔的叠加态中保持自旋',
  },
  {
    order: 2,
    term: '2026-2027',
    department: '主席团与统筹',
    realName: '杨庭益',
    studentId: 'B24041216',
    qq: '3521551489',
    title: '分管协调 · 易班建设部',
    signature: '心平能愈三千疾，心静可通万事理',
  },
  {
    order: 3,
    term: '2026-2027',
    department: '主席团与统筹',
    realName: '李雅婷',
    studentId: 'B24041902',
    qq: '1775706379',
    title: '分管协调 · 媒体宣传部',
    signature: '',
  },
  {
    order: 4,
    term: '2026-2027',
    department: '主席团与统筹',
    realName: '杨婉露',
    studentId: 'B24041703',
    qq: '1694145617',
    title: '分管协调 · 心理工作部',
    signature: '得之我命，失之我幸。',
  },
  {
    order: 5,
    term: '2026-2027',
    department: '运营支持部',
    realName: '赵润芊',
    studentId: 'B25042405',
    qq: '3604611804',
    title: '',
    signature: '',
  },
  {
    order: 6,
    term: '2026-2027',
    department: '运营支持部',
    realName: '白蕊',
    studentId: 'B25042201',
    qq: '2821600451',
    title: '',
    signature: '安好',
  },
  {
    order: 7,
    term: '2026-2027',
    department: '运营支持部',
    realName: '宋子龙',
    studentId: 'B25042314',
    qq: '2304741537',
    title: '',
    signature: '',
  },
  {
    order: 8,
    term: '2026-2027',
    department: '易班建设部',
    realName: '钱俞楠',
    studentId: 'B25040524',
    qq: '3905536819',
    title: '',
    signature: '平淡些，三杯两盏就够了',
  },
  {
    order: 9,
    term: '2026-2027',
    department: '易班建设部',
    realName: '王雨霏',
    studentId: 'B25040801',
    qq: '3980795045',
    title: '',
    signature: '*^_^*\u0000'.slice(0, 5),
  },
  {
    order: 10,
    term: '2026-2027',
    department: '易班建设部',
    realName: '沈冠旭',
    studentId: 'B25041218',
    qq: '3474934240',
    title: '',
    signature: '无限月读',
  },
  {
    order: 11,
    term: '2026-2027',
    department: '媒体宣传部',
    realName: '李文轩',
    studentId: 'B25040304',
    qq: '3916649535',
    title: '',
    signature: '时间从不回答，生命从不喧哗',
  },
  {
    order: 12,
    term: '2026-2027',
    department: '媒体宣传部',
    realName: '胡可',
    studentId: 'B25042404',
    qq: '3473792115',
    title: '',
    signature: '🖤💙',
  },
  {
    order: 13,
    term: '2026-2027',
    department: '媒体宣传部',
    realName: '沈一柏',
    studentId: 'B25042517',
    qq: '753563998',
    title: '',
    signature: 'Still we clash against the sky',
  },
  {
    order: 14,
    term: '2026-2027',
    department: '心理工作部',
    realName: '王丽妍',
    studentId: 'B25040701',
    qq: '3788969130',
    title: '',
    signature: '这是只为了唯一一位读者所写的故事',
  },
  {
    order: 15,
    term: '2026-2027',
    department: '心理工作部',
    realName: '冉可欣',
    studentId: 'B25042102',
    qq: '428126314',
    title: '',
    signature: '在心理学上有个概念叫「浪漫友谊」',
  },
  {
    order: 16,
    term: '2026-2027',
    department: '心理工作部',
    realName: '骆昕彤',
    studentId: 'B25040407',
    qq: '1956613258',
    title: '',
    signature: '这不是强加于我的命运，而是我自己主动背负的命运',
  },
  {
    order: 17,
    term: '2026-2027',
    department: '心理工作部',
    realName: '孙欣妍',
    studentId: 'B25041304',
    qq: '3476855828',
    title: '',
    signature: '美貌与意志并重，女孩不顽强就没办法生存。',
  },
];

export function qqAvatarUrl(qq) {
  return typeof qq === 'string' && /^[1-9]\d{4,11}$/.test(qq)
    ? `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(qq)}&s=640`
    : '';
}

export function buildRosterSnapshot(users, term = '2026-2027', updatedAt = new Date().toISOString()) {
  const rosterUsers = users
    .filter((u) => u && u.term === term && u.department && u.status !== 'disabled')
    .sort((a, b) => ((a.order ?? 999) - (b.order ?? 999)) || String(a.studentId || '').localeCompare(String(b.studentId || '')));

  const departmentOrder = [...DEPARTMENTS_2026_2027];
  for (const u of rosterUsers) {
    if (u.department && !departmentOrder.includes(u.department)) {
      departmentOrder.push(u.department);
    }
  }

  const groups = departmentOrder
    .map((deptName) => {
      const people = rosterUsers
        .filter((u) => u.department === deptName)
        .map((u) => ({
          name: u.realName || u.nickname,
          role: u.title || '',
          avatarUrl: u.avatarUrl || qqAvatarUrl(u.qq),
          signature: u.signature || '',
          featured: deptName === '主席团与统筹',
        }));
      return { name: deptName, people };
    })
    .filter((g) => g.people.length > 0);

  return {
    term,
    updatedAt,
    totalCount: rosterUsers.length,
    activeCount: rosterUsers.filter((u) => u.status === 'active').length,
    groups,
  };
}
