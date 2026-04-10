// Extract a YouTube video ID from any common input format.
//
// Accepts:
//   - Bare 11-char ID:              dQw4w9WgXcQ
//   - Standard watch URL:           https://www.youtube.com/watch?v=dQw4w9WgXcQ
//   - Watch URL with extra params:  https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s
//   - Short URL:                    https://youtu.be/dQw4w9WgXcQ
//   - Embed URL:                    https://www.youtube.com/embed/dQw4w9WgXcQ
//   - Shorts URL:                   https://www.youtube.com/shorts/dQw4w9WgXcQ
//   - Mobile URLs (m.youtube.com):  https://m.youtube.com/watch?v=dQw4w9WgXcQ
//
// Returns the 11-character ID on success, or null on failure.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseYouTubeId(input) {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;

  // Bare ID
  if (ID_RE.test(s)) return s;

  // URL forms — match the 11-char ID captured in each known pattern
  const patterns = [
    /(?:^|\/|\?|&)v=([A-Za-z0-9_-]{11})(?:[&?#]|$)/,    // watch?v=ID
    /youtu\.be\/([A-Za-z0-9_-]{11})(?:[?&#]|$)/,        // youtu.be/ID
    /\/embed\/([A-Za-z0-9_-]{11})(?:[?&#]|$)/,          // /embed/ID
    /\/shorts\/([A-Za-z0-9_-]{11})(?:[?&#]|$)/,         // /shorts/ID
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

module.exports = { parseYouTubeId };
