// Cấp độ tu luyện theo Phàm Nhân Tu Tiên: 70 cấp.
// Luyện Khí tầng 1–10, sau đó 12 cảnh giới × 5 bậc.

export const MAX_LEVEL = 70;

const REALMS = ['Trúc Cơ', 'Kết Đan', 'Nguyên Anh', 'Hóa Thần', 'Luyện Hư', 'Hợp Thể', 'Đại Thừa', 'Độ Kiếp', 'Chân Tiên', 'Kim Tiên', 'Thái Ất', 'Đại La'];
const STAGES = ['Sơ Kỳ', 'Trung Kỳ', 'Hậu Kỳ', 'Đỉnh Phong', 'Đại Viên Mãn'];

// EXP cần để lên từ cấp L lên L+1 = L × BASE (mặc định 100): cấp 1→2 cần 100, cấp 2→3 cần 200…
// Mỗi cấp tính lại EXP từ 0. Admin chỉnh BASE trong Cài đặt (level_base_exp).
let BASE = 100;
let TOTALS = []; // TOTALS[L] = tổng EXP tích lũy để đạt cấp L

function build() {
  TOTALS = [0, 0];
  for (let l = 1; l < MAX_LEVEL; l++) TOTALS[l + 1] = TOTALS[l] + expToNext(l);
}

export function expToNext(level) {
  return BASE * level;
}

export function setLevelBase(base) {
  base = Math.max(1, Math.round(+base || 100));
  if (base !== BASE || !TOTALS.length) { BASE = base; build(); }
}
build();

export function realmOf(level) {
  if (level <= 10) return { tier: 0, name: `Luyện Khí ${level}` };
  const i = level - 11;
  const r = Math.floor(i / 5);
  return { tier: r + 1, name: `${REALMS[r]} ${STAGES[i % 5]}` };
}

// Thông tin cấp từ tổng EXP: cấp, tên cảnh giới, màu (tier 0–12), tiến độ lên cấp kế.
export function levelInfo(exp) {
  exp = Math.max(0, Math.floor(exp || 0));
  let lvl = 1;
  while (lvl < MAX_LEVEL && exp >= TOTALS[lvl + 1]) lvl++;
  const { tier, name } = realmOf(lvl);
  const cur = exp - TOTALS[lvl];
  const need = lvl < MAX_LEVEL ? expToNext(lvl) : 0;
  return { lvl, tier, realm: name, cur, need, pct: need ? Math.min(100, Math.round(cur / need * 100)) : 100 };
}

// Gọn cho bình luận / bảng xếp hạng.
export function badge(exp) {
  const i = levelInfo(exp);
  return { lvl: i.lvl, tier: i.tier, realm: i.realm };
}
