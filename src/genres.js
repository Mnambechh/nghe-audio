export const GENRES = [
  { slug: 'ngon-tinh', name: 'Ngôn tình' },
  { slug: 'dam-my', name: 'Đam mỹ' },
];

export function genresOf(track) {
  const tags = String(track.tag || '').split(',').map(tag => tag.trim());
  return GENRES.filter(genre => tags.includes(genre.name)).map(genre => genre.name);
}
