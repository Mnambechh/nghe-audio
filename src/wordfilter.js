// Bộ lọc từ cho bình luận: bình luận chứa từ trong danh sách phải chờ admin duyệt.
// Không phân biệt hoa thường, bắt cả khi chèn dấu chấm/cách giữa các chữ (đ.m, l o n).
// Từ có dấu chỉ bắt đúng dấu đó (tránh "đi" bị bắt nhầm thành "đĩ"); từ không dấu bắt mọi cách viết ("dm" bắt cả "đm", "Đ.M").
import { vnPlain } from './util.js';

export const DEFAULT_WORDS = [
  'dm', 'dmm', 'dcm', 'dkm', 'dit', 'cmm', 'clm', 'vcl', 'vkl', 'đụ', 'địt', 'lồn', 'buồi', 'cặc', 'đéo', 'óc chó', 'con đĩ',
  'súc vật', 'mẹ mày', 'bố mày', 'fuck', 'shit',
  'zalo', 'telegram', 'nhắn tin riêng', 'kiếm tiền online', 'cá độ', 'nhà cái', 'tài xỉu', 'casino',
].join('\n');

const plain = s => vnPlain(s).replace(/[^a-z0-9]+/g, ' ').trim();
const accented = s => String(s ?? '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Ba dạng của nội dung: giữ khoảng trắng, viết liền, và gom các chữ cái đứng lẻ liên tiếp ("l o n" → "lon").
function forms(text) {
  const out = [];
  let run = '';
  for (const w of text.split(' ')) {
    if ([...w].length === 1) { run += w; continue; }
    if (run) { out.push(run); run = ''; }
    out.push(w);
  }
  if (run) out.push(run);
  return { spaced: ' ' + text + ' ', compact: text.replace(/ /g, ''), joined: ' ' + out.join(' ') + ' ' };
}

export function parseWords(text) {
  return [...new Set(String(text || '').split(/[\n,]+/).map(w => w.trim()).filter(Boolean))];
}

// Trả về danh sách từ bị bắt gặp trong nội dung (rỗng nếu sạch).
export function matchWords(body, wordsText) {
  const words = parseWords(wordsText);
  if (!words.length) return [];
  const P = forms(plain(body)), A = forms(accented(body));
  const hits = [];
  for (const w of words) {
    const hasMarks = plain(w) !== accented(w);
    const n = hasMarks ? accented(w) : plain(w);
    if (!n) continue;
    const F = hasMarks ? A : P;
    const c = n.replace(/ /g, '');
    // Từ ngắn (≤3 ký tự) chỉ bắt khi đứng riêng; từ dài bắt cả khi viết liền hoặc dính vào chữ khác.
    if (F.spaced.includes(' ' + n + ' ') || F.joined.includes(' ' + c + ' ') || ([...c].length >= 4 && F.compact.includes(c))) hits.push(w);
  }
  return hits;
}
