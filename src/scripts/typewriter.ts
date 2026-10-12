const phrases = [
  '未来的空白，由你来书写。',
  '在薛定谔的叠加态里，选择温润而纯粹的同行。',
  '去功利化地分享知识，在仙林四年好好生活。',
  '击穿孤岛与壁垒，用代码缝合有温度的数字世界。',
  '大学没有唯一标准答案，慢慢走，学长姐在前面搭把手。',
];

const element = document.getElementById('typewriter-text');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let phrase = 0;
let character = phrases[0].length;
let deleting = true;
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(delay: number) {
  if (!motion.matches && !document.hidden) timer = setTimeout(tick, delay);
}

function tick() {
  if (!element) return;
  const current = phrases[phrase];
  character += deleting ? -1 : 1;
  element.textContent = current.slice(0, character);
  if (deleting && character === 0) {
    deleting = false;
    phrase = (phrase + 1) % phrases.length;
    schedule(450);
  } else if (!deleting && character === current.length) {
    deleting = true;
    schedule(3600);
  } else {
    schedule(deleting ? 35 : 100);
  }
}

function resume() {
  clearTimeout(timer);
  if (motion.matches && element) {
    element.textContent = phrases[0];
    phrase = 0;
    character = phrases[0].length;
    deleting = true;
  }
  schedule(3500);
}

if (element) {
  resume();
  document.addEventListener('visibilitychange', resume);
  motion.addEventListener('change', resume);
}
