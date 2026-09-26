// Dekiru Nihongo Pre-Intermediate Japanese Learning App
// Full Interactive Logic (Vanilla JavaScript)

(function () {
  // App State
  let allWords = [];
  let filteredWords = [];
  let currentLesson = 1; // 1 = Lesson 1 by default
  let searchKeyword = '';
  let activeFilterChip = 'all'; // 'all', 'fav', 'due', 'hard'
  let showFurigana = true;
  let showRomaji = true;
  let showEnglish = true;
  let showBangla = true;
  let revealedWords = new Set(); // set of "id_en" or "id_bn"
  let fcRevealedEn = false;
  let fcRevealedBn = false;
  let audioSpeed = 0.9;
  let activeTab = 'dashboard'; // 'dashboard', 'list', 'flashcard', 'quiz', 'cando'
  let wordListVisibleCount = 15; // Number of words rendered at once in list mode (for low RAM phones)

  // Flashcard State
  let fcList = [];
  let fcIndex = 0;
  let fcCurrentLesson = 0; // 0 = all
  let fcAnswerRevealed = false;

  // Quiz State
  let quizWords = [];
  let quizIndex = 0;
  let quizScore = 0;
  let quizStreak = 0;
  let quizHighestStreak = 0;
  let quizAnswered = false;
  let quizDirection = 'jp-to-bn';
  let quizMistakes = [];
  let quizTimerSeconds = 15;
  let quizCountdown = 0;
  let quizTimerInterval = null;
  let quizLessonScope = 0;
  let sessionQuizAskedIds = new Set();

  // Persistence (LocalStorage)
  const STORAGE_KEY_FAVS = 'dn_vocab_favs_v1';
  const STORAGE_KEY_SRS = 'dn_vocab_srs_v1';
  const STORAGE_KEY_SETTINGS = 'dn_vocab_settings_v1';

  let favorites = new Set();
  let srsData = {}; // id -> { interval: 1|3|7, lastReviewed: timestamp, nextReview: timestamp, level: 'hard'|'good'|'easy' }

  // Load from LocalStorage
  function loadSavedData() {
    try {
      const savedFavs = localStorage.getItem(STORAGE_KEY_FAVS);
      if (savedFavs) {
        favorites = new Set(JSON.parse(savedFavs));
      }
      const savedSrs = localStorage.getItem(STORAGE_KEY_SRS);
      if (savedSrs) {
        srsData = JSON.parse(savedSrs);
      }
      const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (parsed.audioSpeed) audioSpeed = parsed.audioSpeed;
        if (typeof parsed.showFurigana === 'boolean') showFurigana = parsed.showFurigana;
        if (typeof parsed.showRomaji === 'boolean') showRomaji = parsed.showRomaji;
        if (typeof parsed.showEnglish === 'boolean') showEnglish = parsed.showEnglish;
        if (typeof parsed.showBangla === 'boolean') showBangla = parsed.showBangla;
      }
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(STORAGE_KEY_FAVS, JSON.stringify([...favorites]));
    } catch (e) {}
  }

  function saveSrs() {
    try {
      localStorage.setItem(STORAGE_KEY_SRS, JSON.stringify(srsData));
    } catch (e) {}
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({ 
        audioSpeed, 
        showFurigana, 
        showRomaji,
        showEnglish, 
        showBangla 
      }));
    } catch (e) {}
  }

  // Japanese Audio Speech (TTS)
  function playAudio(text) {
    if (!('speechSynthesis' in window)) {
      alert('Your browser does not support speech synthesis.');
      return;
    }
    window.speechSynthesis.cancel(); // stop any active speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = audioSpeed;

    // Pick best Japanese voice if available
    const voices = window.speechSynthesis.getVoices();
    const jaVoice = voices.find(v => v.lang === 'ja-JP' || v.lang.startsWith('ja'));
    if (jaVoice) {
      utterance.voice = jaVoice;
    }
    window.speechSynthesis.speak(utterance);
  }

  // Simple Synthesizer Audio for Quiz Dings & Buzzers
  let audioCtx = null;
  function playSfx(type) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'correct') {
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, audioCtx.currentTime);
        osc.frequency.setValueAtTime(160, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      }
    } catch (e) {}
  }

  // Render Furigana with HTML <ruby> and <rt>
  function renderRuby(kanji, furigana) {
    if (!furigana || furigana === kanji) {
      return `<span>${escapeHtml(kanji)}</span>`;
    }
    return `<ruby>${escapeHtml(kanji)}<rt>${escapeHtml(furigana)}</rt></ruby>`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Filter Vocabulary Based on Filters
  function filterVocabulary(resetPagination = true) {
    if (resetPagination) {
      wordListVisibleCount = 15;
    }
    const kw = searchKeyword.toLowerCase().trim();
    const now = Date.now();

    filteredWords = allWords.filter(item => {
      // Lesson filter
      if (currentLesson > 0 && item.lesson !== currentLesson) {
        return false;
      }

      // Quick filter chips
      if (activeFilterChip === 'fav' && !favorites.has(item.id)) {
        return false;
      }
      if (activeFilterChip === 'due') {
        const srs = srsData[item.id];
        if (!srs || srs.nextReview > now) return false;
      }
      if (activeFilterChip === 'hard') {
        const srs = srsData[item.id];
        if (!srs || srs.level !== 'hard') return false;
      }

      // Keyword Search
      if (kw) {
        const matchKanji = item.kanji && item.kanji.toLowerCase().includes(kw);
        const matchFurigana = item.furigana && item.furigana.toLowerCase().includes(kw);
        const matchRomaji = item.romaji && item.romaji.toLowerCase().includes(kw);
        const matchEn = item.en && item.en.toLowerCase().includes(kw);
        const matchBn = item.bn && item.bn.includes(kw);
        if (!matchKanji && !matchFurigana && !matchRomaji && !matchEn && !matchBn) {
          return false;
        }
      }

      return true;
    });

    renderWordList();
    updateHeaderStats();
  }

  // Dynamic HTML for translations supporting toggle & reveal
  function getEnRowHtml(item) {
    const isRevealed = revealedWords.has(`${item.id}_en`);
    if (showEnglish || isRevealed) {
      return `
        <div class="flex items-baseline space-x-2">
          <span class="text-[10px] font-bold px-1 py-0.5 rounded bg-sky-950/80 text-sky-400 border border-sky-800/50 uppercase tracking-wider">EN</span>
          <span class="text-slate-200 font-medium">${escapeHtml(item.en)}</span>
        </div>
        ${!showEnglish ? `
          <button onclick="window.hideCardText(event, ${item.id}, 'en')" class="text-[11px] text-slate-500 hover:text-slate-300 px-1.5 py-0.5 rounded hover:bg-slate-800 transition" title="Hide English">✕</button>
        ` : ''}
      `;
    } else {
      return `
        <div class="flex items-center space-x-2">
          <span class="text-[10px] font-bold px-1 py-0.5 rounded bg-slate-800 text-slate-400 uppercase tracking-wider">EN</span>
          <button onclick="window.revealCardText(event, ${item.id}, 'en')" class="text-[11px] text-slate-400 hover:text-sky-300 bg-slate-800/80 hover:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700/60 transition inline-flex items-center space-x-1.5">
            <span>👁️</span> <span>Show English</span>
          </button>
        </div>
      `;
    }
  }

  function getBnRowHtml(item) {
    const isRevealed = revealedWords.has(`${item.id}_bn`);
    if (showBangla || isRevealed) {
      return `
        <div class="flex items-baseline space-x-2">
          <span class="text-[10px] font-bold px-1 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 font-bangla">বাং</span>
          <span class="text-emerald-400 font-semibold font-bangla">${escapeHtml(item.bn)}</span>
        </div>
        ${!showBangla ? `
          <button onclick="window.hideCardText(event, ${item.id}, 'bn')" class="text-[11px] text-emerald-600 hover:text-emerald-400 px-1.5 py-0.5 rounded hover:bg-emerald-950 font-bangla transition" title="বাংলা লুকান">✕</button>
        ` : ''}
      `;
    } else {
      return `
        <div class="flex items-center space-x-2">
          <span class="text-[10px] font-bold px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-bangla">বাং</span>
          <button onclick="window.revealCardText(event, ${item.id}, 'bn')" class="text-[11px] text-emerald-400/90 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/60 px-2.5 py-1 rounded-lg border border-emerald-800/60 transition inline-flex items-center space-x-1.5 font-bangla">
            <span>👁️</span> <span>বাংলা অর্থ দেখুন</span>
          </button>
        </div>
      `;
    }
  }

  // Render Word List
  function renderWordList() {
    const container = document.getElementById('cards-container');
    const emptyState = document.getElementById('list-empty-state');
    const badge = document.getElementById('word-count-badge');

    if (!container) return;

    badge.textContent = `Showing ${Math.min(wordListVisibleCount, filteredWords.length)} of ${filteredWords.length} words`;

    if (filteredWords.length === 0) {
      container.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    const visibleWords = filteredWords.slice(0, wordListVisibleCount);

    let html = visibleWords.map(item => {
      const isFav = favorites.has(item.id);
      const srs = srsData[item.id];
      let srsBadge = '';
      if (srs) {
        if (srs.level === 'hard') {
          srsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] bg-rose-950/60 text-rose-300 border border-rose-800/50">Hard</span>`;
        } else if (srs.level === 'good') {
          srsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/60 text-amber-300 border border-amber-800/50">Good</span>`;
        } else if (srs.level === 'easy') {
          srsBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">Easy</span>`;
        }
      }

      const rubyClass = showFurigana ? '' : 'hide-ruby';

      return `
        <div id="word-card-${item.id}" class="bg-slate-900 border border-slate-800/90 hover:border-slate-700/90 rounded-2xl p-4 transition-all duration-200 shadow-lg shadow-black/30">
          <div class="flex items-start justify-between mb-2">
            <div class="flex items-center space-x-1.5">
              <span class="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-800 text-sky-400 border border-slate-700/50">
                L${item.lesson}
              </span>
              ${srsBadge}
            </div>

            <div class="flex items-center space-x-1">
              <!-- Copy Button -->
              <button onclick="window.copyWordCard(event, ${item.id})" class="p-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-sky-400 border border-slate-700/60 transition active:scale-95 text-xs" title="শব্দ কপি করুন (Copy Kanji & Kana)">
                📋
              </button>

              <!-- Audio TTS Button -->
              <button onclick="window.playAudio('${item.kanji.replace(/'/g, "\\'")}')" class="p-2 rounded-xl bg-slate-800/90 hover:bg-sky-950 text-slate-300 hover:text-sky-400 border border-slate-700/60 transition active:scale-95" title="উচ্চারণ শুনুন">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
              
              <!-- Favorite Bookmark Button -->
              <button onclick="window.toggleFavorite(${item.id})" class="p-1.5 text-base transition rounded-lg hover:bg-slate-800 ${isFav ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}" title="বুকমার্ক">
                ★
              </button>
            </div>
          </div>

          <!-- Main Japanese Display -->
          <div class="my-1.5 cursor-pointer select-text" onclick="window.toggleCardFuriganaPeek(event, ${item.id})" title="${showFurigana ? '' : 'ফুরিগানা দেখতে ট্যাপ করুন (Tap to peek furigana)'}">
            <div id="ruby-${item.id}" class="text-2xl font-bold tracking-wide text-white leading-relaxed font-japanese ${rubyClass}">
              ${renderRuby(item.kanji, item.furigana)}
            </div>
            ${showRomaji ? `
              <div class="text-xs text-slate-400 font-mono mt-0.5 tracking-wider">
                [${escapeHtml(item.romaji)}]
              </div>
            ` : ''}
          </div>

          <!-- Translations with Visibility Controls -->
          <div class="mt-3 pt-2.5 border-t border-slate-800/80 grid grid-cols-1 gap-2 text-xs">
            <div id="word-trans-en-${item.id}" class="flex items-center justify-between min-h-[26px]">
              ${getEnRowHtml(item)}
            </div>
            <div id="word-trans-bn-${item.id}" class="flex items-center justify-between min-h-[26px]">
              ${getBnRowHtml(item)}
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (filteredWords.length > wordListVisibleCount) {
      html += `
        <div class="pt-4 text-center pb-8">
          <button onclick="window.loadMoreWords()" class="w-full py-4 rounded-2xl bg-slate-900 border-2 border-slate-800 hover:border-sky-500/40 text-sky-400 hover:text-sky-300 font-extrabold text-xs transition active:scale-98 flex items-center justify-center space-x-2 shadow-xl hover:shadow-sky-500/5">
            <span>🔽</span>
            <span class="font-bangla">আরো শব্দ লোড করুন (Show ${filteredWords.length - wordListVisibleCount} More Words)</span>
          </button>
        </div>
      `;
    }

    const prevScrollY = window.scrollY;
    container.innerHTML = html;
    // Restore scroll position after DOM rewrite to prevent jump
    window.scrollTo(0, prevScrollY);
  }

  // Update Header Stats
  function updateHeaderStats() {
    const countEl = document.getElementById('header-learned-count');
    if (countEl) {
      const reviewedCount = Object.keys(srsData).length;
      countEl.textContent = `${reviewedCount} / ${allWords.length}`;
    }
  }

  // Track Hard words flagged during the active flashcard study session & unstudied count
  let sessionHardWords = [];
  let fcUnstudiedCount = 0;

  // Flashcard Logic (Clean, Intuitive, Fast)
  function initFlashcards() {
    sessionHardWords = [];
    let currentLessonWords = [];
    if (fcCurrentLesson === 0) {
      if (currentLesson > 0) {
        fcCurrentLesson = currentLesson;
        currentLessonWords = allWords.filter(w => w.lesson === fcCurrentLesson);
      } else if (activeFilterChip === 'fav') {
        currentLessonWords = allWords.filter(w => favorites.has(w.id));
        if (currentLessonWords.length === 0) currentLessonWords = [...allWords];
      } else if (activeFilterChip === 'hard') {
        currentLessonWords = allWords.filter(w => srsData[w.id] && srsData[w.id].level === 'hard');
        if (currentLessonWords.length === 0) currentLessonWords = [...allWords];
      } else {
        currentLessonWords = [...allWords];
      }
    } else {
      currentLessonWords = allWords.filter(w => w.lesson === fcCurrentLesson);
      if (currentLessonWords.length === 0) currentLessonWords = [...allWords];
    }

    // Separate Unstudied (New) words and Studied words
    const unstudied = currentLessonWords.filter(w => !srsData[w.id]);
    const studied = currentLessonWords.filter(w => srsData[w.id]);

    fcUnstudiedCount = unstudied.length;

    // Prioritize Unstudied (New) words FIRST in natural textbook order
    if (unstudied.length > 0) {
      fcList = [...unstudied, ...studied];
    } else {
      fcList = [...currentLessonWords];
    }

    const sel = document.getElementById('fc-lesson-select');
    if (sel) sel.value = String(fcCurrentLesson);

    fcIndex = 0;
    fcAnswerRevealed = false;
    renderCurrentFlashcard();
  }

  function renderCurrentFlashcard() {
    const cardBody = document.getElementById('fc-card-body');

    if (!fcList || fcList.length === 0) {
      if (cardBody) {
        cardBody.innerHTML = `
          <div class="py-12 text-center text-slate-400">
            <div class="text-4xl mb-2">📭</div>
            <p class="text-sm font-medium text-slate-300">কোনো শব্দ পাওয়া যায়নি</p>
            <p class="text-xs text-slate-500 mt-1">এই লেসনে বা ফিল্টারে শব্দ নেই।</p>
            <button onclick="window.handleFcLessonSelect(0)" class="mt-4 px-3 py-1.5 bg-sky-950 text-sky-400 border border-sky-800/60 rounded-xl text-xs font-semibold hover:bg-sky-900 transition">
              সব লেসনের শব্দ দেখুন (All Lessons)
            </button>
          </div>
        `;
      }
      return;
    }

    // Check if new words pass / session pass completed
    const passLimit = fcUnstudiedCount > 0 ? fcUnstudiedCount : fcList.length;
    if (fcIndex >= passLimit) {
      if (cardBody) {
        let lEasy = 0, lGood = 0, lHard = 0;
        fcList.forEach(w => {
          const s = srsData[w.id];
          if (s) {
            if (s.level === 'easy') lEasy++;
            else if (s.level === 'good') lGood++;
            else if (s.level === 'hard') lHard++;
          }
        });

        const unreviewedHard = sessionHardWords.length;

        cardBody.innerHTML = `
          <div class="py-6 px-2 text-center space-y-4 animate-fadeIn">
            <div class="w-14 h-14 rounded-2xl bg-emerald-500/20 border-2 border-emerald-500/80 flex items-center justify-center text-2xl mx-auto shadow-lg shadow-emerald-500/20">
              🎉
            </div>
            <div>
              <h3 class="text-base font-bold text-white font-bangla">
                ${fcUnstudiedCount > 0 ? `লেসন ${fcCurrentLesson > 0 ? fcCurrentLesson : ''} এর ${fcUnstudiedCount}টি নতুন শব্দ পড়া সম্পন্ন!` : `লেসন ${fcCurrentLesson > 0 ? fcCurrentLesson : ''} এর প্রথম ধাপ পড়া সম্পন্ন!`}
              </h3>
              <p class="text-xs text-slate-400 mt-0.5 font-bangla">সকল শব্দ সফলভাবে রিভিশন দেওয়া হয়েছে</p>
            </div>
            
            <div class="bg-slate-850 border border-slate-800 rounded-2xl p-3.5 space-y-2 text-xs font-bangla">
              <div class="flex justify-between items-center text-emerald-300"><span>🟢 সহজ (Mastered):</span><strong class="font-mono text-sm">${lEasy}টি</strong></div>
              <div class="flex justify-between items-center text-amber-300"><span>🟡 মোটামুটি (Learning):</span><strong class="font-mono text-sm">${lGood}টি</strong></div>
              <div class="flex justify-between items-center text-rose-300"><span>🔴 কঠিন (Hard):</span><strong class="font-mono text-sm">${lHard}টি</strong></div>
            </div>

            <div class="space-y-2 pt-1 font-bangla">
              ${unreviewedHard > 0 ? `
                <button onclick="window.startSessionHardReview()" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 text-white font-bold text-xs shadow-lg transition active:scale-98 flex items-center justify-center space-x-1">
                  <span>🔴</span> <span>চিহ্নিত কঠিন শব্দগুলো রিভিশন দিন (${unreviewedHard}টি)</span>
                </button>
              ` : ''}
              <button onclick="window.restartCurrentLessonFc()" class="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 font-semibold text-xs border border-slate-700 transition">
                🔄 এই লেসন আবার শুরু থেকে পড়ুন (সকল ${fcList.length}টি শব্দ)
              </button>
              ${fcCurrentLesson > 0 && fcCurrentLesson < 15 ? `
                <button onclick="window.handleFcLessonSelect(${fcCurrentLesson + 1})" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-emerald-400 text-slate-950 font-bold text-xs shadow-lg transition active:scale-98">
                  পরের লেসনে যান (Lesson ${fcCurrentLesson + 1}) →
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }
      return;
    }

    if (fcIndex < 0) fcIndex = 0;

    const item = fcList[fcIndex];

    // Progress Label & Progress Bar
    const progressLabel = document.getElementById('fc-progress-label');
    if (progressLabel) {
      if (fcUnstudiedCount > 0 && fcIndex < fcUnstudiedCount) {
        progressLabel.textContent = `নতুন শব্দ ${fcIndex + 1} / ${fcUnstudiedCount} (মোট ${fcList.length})`;
      } else {
        progressLabel.textContent = `কার্ড ${fcIndex + 1} / ${fcList.length}`;
      }
    }
    const progressBar = document.getElementById('fc-progress-bar');
    if (progressBar) {
      const targetTotal = fcUnstudiedCount > 0 ? fcUnstudiedCount : fcList.length;
      const pct = Math.min(100, Math.round(((fcIndex + 1) / targetTotal) * 100));
      progressBar.style.width = `${pct}%`;
    }

    // Dynamic SRS Deck Stats Summary Pill Bar
    const deckSummaryEl = document.getElementById('fc-deck-srs-summary');
    if (deckSummaryEl) {
      let dHard = 0, dGood = 0, dEasy = 0, dNew = 0;
      fcList.forEach(w => {
        const s = srsData[w.id];
        if (!s) dNew++;
        else if (s.level === 'hard') dHard++;
        else if (s.level === 'good') dGood++;
        else if (s.level === 'easy') dEasy++;
      });
      deckSummaryEl.innerHTML = `
        ${dHard > 0 ? `<span class="text-rose-400" title="Hard">🔴${dHard}</span>` : ''}
        ${dGood > 0 ? `<span class="text-amber-400" title="Good">🟡${dGood}</span>` : ''}
        ${dEasy > 0 ? `<span class="text-emerald-400" title="Easy">🟢${dEasy}</span>` : ''}
        ${dNew > 0 ? `<span class="text-slate-400" title="Unstudied">⚪${dNew}</span>` : ''}
      `;
    }

    // SRS Status Pill
    const srsPill = document.getElementById('fc-srs-status-pill');
    if (srsPill) {
      const srs = srsData[item.id];
      if (srs) {
        srsPill.textContent = srs.level === 'hard' ? '🔴 Hard' : srs.level === 'good' ? '🟡 Good' : '🟢 Easy';
        srsPill.className = `text-[10px] px-2 py-0.5 rounded-md font-bold ${
          srs.level === 'hard'
            ? 'bg-rose-950/80 text-rose-300 border border-rose-800/80'
            : srs.level === 'good'
            ? 'bg-amber-950/80 text-amber-300 border border-amber-800/80'
            : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80'
        }`;
      } else {
        srsPill.textContent = 'New Word';
        srsPill.className = 'text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700';
      }
    }

    // Bookmark Star
    const starBtn = document.getElementById('fc-star-btn');
    if (starBtn) {
      const isFav = favorites.has(item.id);
      starBtn.className = `py-1.5 px-2 bg-slate-800 hover:bg-slate-750 text-slate-400 hover:text-amber-400 rounded-xl border border-slate-700/80 text-sm transition flex items-center justify-center ${isFav ? 'text-amber-400 scale-110' : ''}`;
      starBtn.title = isFav ? 'বুকমার্ক সরানো' : 'বুকমার্ক করুন';
    }

    // Furigana Button Highlight
    const furiBtn = document.getElementById('fc-btn-toggle-furigana');
    if (furiBtn) {
      furiBtn.className = showFurigana
        ? 'py-1.5 px-2 bg-sky-950/80 text-sky-400 border border-sky-700/80 rounded-xl text-xs font-bold transition flex items-center justify-center shadow-sm'
        : 'py-1.5 px-2 bg-slate-800 hover:bg-slate-750 text-slate-500 border border-slate-700/80 rounded-xl text-xs font-bold transition flex items-center justify-center line-through';
    }

    // Lesson tag
    const lessonTag = document.getElementById('fc-card-lesson-tag');
    if (lessonTag) {
      lessonTag.textContent = `Lesson ${item.lesson}`;
    }

    // Kanji & Furigana
    const kanjiDisplay = document.getElementById('fc-kanji-display');
    if (kanjiDisplay) {
      kanjiDisplay.innerHTML = renderRuby(item.kanji, item.furigana);
      kanjiDisplay.className = `text-3xl sm:text-4xl font-bold tracking-wide text-white mb-2 leading-normal select-text ${showFurigana ? '' : 'hide-ruby'}`;
      kanjiDisplay.title = showFurigana ? '' : 'ট্যাপ করে ফুরিগানা দেখুন';
      kanjiDisplay.onclick = (e) => {
        e.stopPropagation();
        kanjiDisplay.classList.toggle('peek-ruby');
      };
    }

    // Romaji
    const romajiDisplay = document.getElementById('fc-romaji-display');
    if (romajiDisplay) {
      romajiDisplay.textContent = `[${item.romaji}]`;
      romajiDisplay.style.display = showRomaji ? 'block' : 'none';
    }

    // Meanings
    const bnBox = document.getElementById('fc-box-bn');
    const bnMeaning = document.getElementById('fc-meaning-bn');
    if (bnMeaning) bnMeaning.textContent = item.bn;
    if (bnBox) bnBox.style.display = showBangla ? 'block' : 'none';

    const enBox = document.getElementById('fc-box-en');
    const enMeaning = document.getElementById('fc-meaning-en');
    if (enMeaning) enMeaning.textContent = item.en;
    if (enBox) enBox.style.display = showEnglish ? 'block' : 'none';

    // Answer revealed state
    const answerContainer = document.getElementById('fc-answer-container');
    const unrevealedControls = document.getElementById('fc-unrevealed-controls');
    const revealedControls = document.getElementById('fc-revealed-controls');
    const hintEl = document.getElementById('fc-card-hint');

    if (fcAnswerRevealed) {
      if (answerContainer) answerContainer.classList.remove('hidden');
      if (unrevealedControls) unrevealedControls.classList.add('hidden');
      if (revealedControls) revealedControls.classList.remove('hidden');
      if (hintEl) {
        hintEl.innerHTML = `<span>👆</span> <span>কার্ডে ট্যাপ করলে আবার প্রশ্ন দেখা যাবে</span>`;
      }
    } else {
      if (answerContainer) answerContainer.classList.add('hidden');
      if (unrevealedControls) unrevealedControls.classList.remove('hidden');
      if (revealedControls) revealedControls.classList.add('hidden');
      if (hintEl) {
        hintEl.innerHTML = `<span>👆</span> <span>ট্যাপ করে অর্থ দেখুন (Tap to show answer)</span>`;
      }
    }
  }

  function handleCardClick() {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) {
      return; // Do not flip card if user is selecting/copying text
    }
    fcAnswerRevealed = !fcAnswerRevealed;
    renderCurrentFlashcard();
  }

  function revealCardAnswer() {
    fcAnswerRevealed = true;
    renderCurrentFlashcard();
  }

  function hideCardAnswer() {
    fcAnswerRevealed = false;
    renderCurrentFlashcard();
  }

  function navigateFlashcard(dir) {
    if (fcList.length === 0) return;
    fcIndex += dir;
    if (fcIndex < 0) fcIndex = fcList.length - 1;
    fcAnswerRevealed = false;
    renderCurrentFlashcard();
  }

  function shuffleFlashcards() {
    if (fcList.length <= 1) return;
    for (let i = fcList.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fcList[i], fcList[j]] = [fcList[j], fcList[i]];
    }
    fcIndex = 0;
    fcAnswerRevealed = false;
    renderCurrentFlashcard();
  }

  function handleFcLessonSelect(val) {
    const lNum = parseInt(val, 10) || 0;
    fcCurrentLesson = lNum;
    initFlashcards();
  }

  function toggleFcQuickFurigana() {
    showFurigana = !showFurigana;
    saveSettings();
    syncDisplayToggleButtons();
    renderCurrentFlashcard();
    renderWordList();
  }

  function handleSrsRating(level) {
    if (fcList.length === 0 || fcIndex >= fcList.length) return;
    const currentItem = fcList[fcIndex];
    const now = Date.now();
    const days = level === 'hard' ? 1 : level === 'good' ? 3 : 7;
    const nextReview = now + days * 24 * 60 * 60 * 1000;

    srsData[currentItem.id] = {
      level,
      interval: days,
      lastReviewed: now,
      nextReview
    };

    saveSrs();
    updateHeaderStats();

    // If rated Hard, record in session review queue
    if (level === 'hard') {
      if (!sessionHardWords.some(w => w.id === currentItem.id)) {
        sessionHardWords.push(currentItem);
      }
      showToast('🔴 Hard marked (Saved for end-of-round review)');
    } else if (level === 'easy') {
      showToast('🟢 Easy marked');
    } else {
      showToast('🟡 Good marked');
    }

    // Linearly advance to next card (NO interruption of new words flow!)
    fcIndex++;
    fcAnswerRevealed = false;
    renderCurrentFlashcard();
  }

  window.startSessionHardReview = function () {
    if (sessionHardWords.length === 0) return;
    fcList = [...sessionHardWords];
    sessionHardWords = [];
    fcIndex = 0;
    fcAnswerRevealed = false;
    renderCurrentFlashcard();
  };

  window.restartCurrentLessonFc = function () {
    sessionHardWords = [];
    fcUnstudiedCount = 0;
    if (fcCurrentLesson === 0) fcList = [...allWords];
    else fcList = allWords.filter(w => w.lesson === fcCurrentLesson);
    fcIndex = 0;
    fcAnswerRevealed = false;
    renderCurrentFlashcard();
  };

  // Quiz Mode Logic
  function stopQuizTimer() {
    if (quizTimerInterval) {
      clearInterval(quizTimerInterval);
      quizTimerInterval = null;
    }
  }

  function startQuizTimer() {
    stopQuizTimer();
    const timerBadge = document.getElementById('quiz-timer-badge');
    const timerText = document.getElementById('quiz-timer-text');

    if (!quizTimerSeconds || quizTimerSeconds <= 0) {
      if (timerBadge) timerBadge.classList.add('hidden');
      return;
    }

    quizCountdown = quizTimerSeconds;
    if (timerBadge) {
      timerBadge.classList.remove('hidden');
      timerBadge.className = 'px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700/80 font-bold font-mono text-xs flex items-center space-x-1';
    }
    if (timerText) timerText.textContent = `${quizCountdown}s`;

    quizTimerInterval = setInterval(() => {
      quizCountdown--;
      if (timerText) timerText.textContent = `${quizCountdown}s`;

      if (quizCountdown <= 3) {
        if (timerBadge) {
          timerBadge.className = 'px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-600 font-bold font-mono text-xs flex items-center space-x-1 animate-pulse';
        }
      }

      if (quizCountdown <= 0) {
        stopQuizTimer();
        handleQuizTimeout();
      }
    }, 1000);
  }

  function handleQuizTimeout() {
    if (quizAnswered) return;
    quizAnswered = true;

    const currentQ = quizWords[quizIndex];
    if (!currentQ) return;

    quizStreak = 0;
    playSfx('incorrect');

    if (!quizMistakes.some(m => m.id === currentQ.id)) {
      quizMistakes.push(currentQ);
    }

    const optButtons = document.querySelectorAll('.quiz-option-btn');
    optButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('cursor-default');
      if (btn.getAttribute('onclick').includes(`handleQuizAnswer(${currentQ.id},`)) {
        btn.classList.remove('bg-slate-900', 'border-slate-800');
        btn.classList.add('bg-emerald-950/60', 'border-emerald-500', 'text-emerald-200');
        const correctIcon = btn.querySelector('.opt-icon');
        if (correctIcon) correctIcon.textContent = '✓';
      }
    });

    const feedbackBox = document.getElementById('quiz-feedback-box');
    const feedbackTitle = document.getElementById('quiz-feedback-title');
    const feedbackDetails = document.getElementById('quiz-feedback-details');
    const feedbackText = document.getElementById('quiz-feedback-text');
    const nextBtn = document.getElementById('quiz-next-btn');

    if (feedbackBox && feedbackText && nextBtn) {
      feedbackBox.classList.remove('hidden');
      feedbackBox.className = 'mb-3 p-3 rounded-xl border border-rose-800 bg-rose-950/40 text-xs text-rose-200';
      feedbackTitle.textContent = '⏰ সময় শেষ! (Time Out)';
      feedbackDetails.textContent = `L${currentQ.lesson} • [${currentQ.romaji}]`;
      feedbackText.innerHTML = `
        <div class="mt-1 space-y-0.5">
          <div><span class="font-bold text-white">${currentQ.kanji}</span> (${currentQ.furigana})</div>
          <div><strong class="text-slate-400">English:</strong> ${currentQ.en}</div>
          <div><strong class="text-emerald-400">বাংলা:</strong> ${currentQ.bn}</div>
        </div>
      `;

      nextBtn.classList.remove('hidden');
    }
  }

  window.handleTimerSettingChange = function (val) {
    quizTimerSeconds = parseInt(val, 10) || 0;
    initQuiz();
  };

  window.handleQuizLessonChange = function (val) {
    quizLessonScope = parseInt(val, 10) || 0;
    sessionQuizAskedIds.clear();
    initQuiz();
  };

  function initQuiz(overrideWords) {
    stopQuizTimer();
    quizMistakes = [];
    const dirEl = document.getElementById('quiz-direction');
    if (dirEl) quizDirection = dirEl.value;

    const quizLessonSel = document.getElementById('quiz-lesson-select');
    if (quizLessonSel) quizLessonScope = parseInt(quizLessonSel.value, 10) || 0;

    let pool = [];
    if (overrideWords && Array.isArray(overrideWords) && overrideWords.length > 0) {
      pool = [...overrideWords];
    } else {
      let sourcePool = allWords;
      if (quizLessonScope > 0) {
        sourcePool = allWords.filter(w => w.lesson === quizLessonScope);
      } else if (filteredWords.length >= 4 && filteredWords.length < allWords.length) {
        sourcePool = filteredWords;
      }

      // Dynamically exclude words that are already mastered (level === 'easy')
      const unmasteredPool = sourcePool.filter(w => !srsData[w.id] || srsData[w.id].level !== 'easy');
      const candidatePool = unmasteredPool.length >= 4 ? unmasteredPool : sourcePool;

      // Filter out words already asked in previous rounds of this session
      let unseenPool = candidatePool.filter(w => !sessionQuizAskedIds.has(w.id));

      // If we ran out of unseen words in this lesson, reset tracking and cycle again
      if (unseenPool.length < 4) {
        sessionQuizAskedIds.clear();
        unseenPool = candidatePool;
      }

      pool = unseenPool;
    }

    quizWords = [...pool];
    // Shuffle pool
    for (let i = quizWords.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [quizWords[i], quizWords[j]] = [quizWords[j], quizWords[i]];
    }
    // Pick up to 10 questions
    quizWords = quizWords.slice(0, 10);

    // Track asked question IDs so next round gets different words
    if (!overrideWords) {
      quizWords.forEach(w => sessionQuizAskedIds.add(w.id));
    }

    quizIndex = 0;
    quizScore = 0;
    quizStreak = 0;
    quizHighestStreak = 0;

    const playScreen = document.getElementById('quiz-screen-play');
    const resScreen = document.getElementById('quiz-screen-result');
    if (playScreen) playScreen.classList.remove('hidden');
    if (resScreen) resScreen.classList.add('hidden');

    renderCurrentQuizQuestion();
  }

  function renderCurrentQuizQuestion() {
    stopQuizTimer();
    quizAnswered = false;
    const q = quizWords[quizIndex];
    if (!q) {
      showQuizResults();
      return;
    }

    // Hide feedback & next button
    const feedbackBox = document.getElementById('quiz-feedback-box');
    const nextBtn = document.getElementById('quiz-next-btn');
    if (feedbackBox) feedbackBox.classList.add('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');

    // Status
    const qNum = document.getElementById('quiz-question-num');
    if (qNum) qNum.textContent = `Question ${quizIndex + 1} of ${quizWords.length}`;
    const scoreBadge = document.getElementById('quiz-score-badge');
    if (scoreBadge) scoreBadge.textContent = `${quizScore} / ${quizWords.length}`;
    const streakEl = document.getElementById('quiz-streak-count');
    if (streakEl) streakEl.textContent = `${quizStreak}`;

    // Lesson Badge on Card
    const cardLessonTag = document.getElementById('quiz-card-lesson-tag');
    if (cardLessonTag) cardLessonTag.textContent = `Lesson ${q.lesson}`;

    // Prompt
    const rubyEl = document.getElementById('quiz-prompt-ruby');
    const subEl = document.getElementById('quiz-prompt-sub');
    const tagEl = document.getElementById('quiz-question-tag');

    if (quizDirection === 'bn-to-jp') {
      if (tagEl) tagEl.textContent = 'Select the Japanese word for:';
      if (rubyEl) rubyEl.innerHTML = `<span class="font-bangla text-emerald-300 text-3xl font-bold">${escapeHtml(q.bn)}</span>`;
      if (subEl) subEl.textContent = q.en;
    } else if (quizDirection === 'jp-to-en') {
      if (tagEl) tagEl.textContent = 'Select the English meaning for:';
      if (rubyEl) rubyEl.innerHTML = renderRuby(q.kanji, q.furigana);
      if (subEl) subEl.textContent = `[${q.romaji}]`;
    } else {
      // jp-to-bn
      if (tagEl) tagEl.textContent = 'Select the বাংলা meaning for:';
      if (rubyEl) rubyEl.innerHTML = renderRuby(q.kanji, q.furigana);
      if (subEl) subEl.textContent = `[${q.romaji}]`;
    }

    // Auto pronounce Japanese prompt
    if (quizDirection !== 'bn-to-jp') {
      playAudio(q.kanji);
    }

    // Prepare 4 choices (1 correct + 3 distinct distractors)
    const options = [q];
    const otherWords = allWords.filter(w => w.id !== q.id);
    while (options.length < 4 && otherWords.length > 0) {
      const rand = otherWords[Math.floor(Math.random() * otherWords.length)];
      if (!options.some(opt => opt.id === rand.id)) {
        options.push(rand);
      }
    }
    // Shuffle options
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    // Render Options
    const optContainer = document.getElementById('quiz-options-container');
    if (!optContainer) return;

    optContainer.innerHTML = options.map((opt, i) => {
      let label = '';
      if (quizDirection === 'bn-to-jp') {
        label = `${opt.kanji} <span class="text-xs text-slate-400 font-mono ml-1">(${opt.furigana})</span>`;
      } else if (quizDirection === 'jp-to-en') {
        label = opt.en;
      } else {
        label = `<span class="font-bangla font-semibold text-emerald-300 text-sm">${opt.bn}</span> <span class="text-slate-400 text-xs ml-1">(${opt.en})</span>`;
      }

      return `
        <button onclick="window.handleQuizAnswer(${opt.id}, ${q.id}, this)" class="quiz-option-btn w-full p-3.5 rounded-xl bg-slate-900 border-2 border-slate-800 hover:border-sky-500/50 text-left text-xs font-medium text-slate-200 transition-all flex items-center justify-between active:scale-98">
          <div class="flex items-center space-x-2.5">
            <span class="w-6 h-6 rounded-lg bg-slate-800 text-slate-400 font-bold flex items-center justify-center text-xs border border-slate-700">
              ${['A', 'B', 'C', 'D'][i]}
            </span>
            <span>${label}</span>
          </div>
          <span class="opt-icon text-base"></span>
        </button>
      `;
    }).join('');

    // Start live countdown timer
    startQuizTimer();
  }

  function handleQuizAnswer(selectedId, correctId, btnElement) {
    if (quizAnswered) return;
    quizAnswered = true;
    stopQuizTimer();

    const isCorrect = selectedId === correctId;
    const currentQ = quizWords[quizIndex];

    const optButtons = document.querySelectorAll('.quiz-option-btn');
    optButtons.forEach(btn => {
      btn.disabled = true;
      btn.classList.add('cursor-default');
    });

    if (isCorrect) {
      quizScore++;
      quizStreak++;
      if (quizStreak > quizHighestStreak) quizHighestStreak = quizStreak;
      playSfx('correct');

      btnElement.classList.remove('bg-slate-900', 'border-slate-800');
      btnElement.classList.add('bg-emerald-950/60', 'border-emerald-500', 'text-emerald-200');
      const icon = btnElement.querySelector('.opt-icon');
      if (icon) icon.textContent = '✓';
    } else {
      quizStreak = 0;
      playSfx('incorrect');

      if (!quizMistakes.some(m => m.id === currentQ.id)) {
        quizMistakes.push(currentQ);
      }

      btnElement.classList.remove('bg-slate-900', 'border-slate-800');
      btnElement.classList.add('bg-rose-950/60', 'border-rose-500', 'text-rose-200');
      const icon = btnElement.querySelector('.opt-icon');
      if (icon) icon.textContent = '✗';

      // Highlight the correct option
      optButtons.forEach(btn => {
        if (btn.getAttribute('onclick').includes(`handleQuizAnswer(${correctId},`)) {
          btn.classList.remove('bg-slate-900', 'border-slate-800');
          btn.classList.add('bg-emerald-950/60', 'border-emerald-500', 'text-emerald-200');
          const correctIcon = btn.querySelector('.opt-icon');
          if (correctIcon) correctIcon.textContent = '✓';
        }
      });
    }

    // Show Explanation & Next Button
    const feedbackBox = document.getElementById('quiz-feedback-box');
    const feedbackTitle = document.getElementById('quiz-feedback-title');
    const feedbackDetails = document.getElementById('quiz-feedback-details');
    const feedbackText = document.getElementById('quiz-feedback-text');
    const nextBtn = document.getElementById('quiz-next-btn');

    if (feedbackBox && feedbackText && nextBtn) {
      feedbackBox.classList.remove('hidden');
      if (isCorrect) {
        feedbackBox.className = 'mb-3 p-3 rounded-xl border border-emerald-800 bg-emerald-950/40 text-xs text-emerald-200';
        feedbackTitle.textContent = 'Correct! 正解です！';
      } else {
        feedbackBox.className = 'mb-3 p-3 rounded-xl border border-rose-800 bg-rose-950/40 text-xs text-rose-200';
        feedbackTitle.textContent = 'Incorrect / 残念！';
      }
      feedbackDetails.textContent = `L${currentQ.lesson} • [${currentQ.romaji}]`;
      feedbackText.innerHTML = `
        <div class="mt-1 space-y-0.5">
          <div><span class="font-bold text-white">${currentQ.kanji}</span> (${currentQ.furigana})</div>
          <div><strong class="text-slate-400">English:</strong> ${currentQ.en}</div>
          <div><strong class="text-emerald-400">বাংলা:</strong> ${currentQ.bn}</div>
        </div>
      `;

      nextBtn.classList.remove('hidden');
    }
  }

  function nextQuizQuestion() {
    quizIndex++;
    if (quizIndex < quizWords.length) {
      renderCurrentQuizQuestion();
    } else {
      showQuizResults();
    }
  }

  function showQuizResults() {
    stopQuizTimer();
    const playScreen = document.getElementById('quiz-screen-play');
    const resScreen = document.getElementById('quiz-screen-result');
    if (playScreen) playScreen.classList.add('hidden');
    if (resScreen) resScreen.classList.remove('hidden');

    const scoreEl = document.getElementById('res-score-text');
    const accEl = document.getElementById('res-accuracy-text');
    const streakEl = document.getElementById('res-streak-text');

    const total = quizWords.length;
    const accuracy = total > 0 ? Math.round((quizScore / total) * 100) : 0;

    if (scoreEl) scoreEl.textContent = `${quizScore} / ${total}`;
    if (accEl) accEl.textContent = `${accuracy}%`;
    if (streakEl) streakEl.textContent = `🔥 ${quizHighestStreak}`;

    // Render Post-Quiz Recommendations based on mistakes
    const recContainer = document.getElementById('quiz-recommendations-container');
    if (recContainer) {
      if (quizMistakes.length > 0) {
        // Group mistakes by lesson
        const lessonMap = {};
        quizMistakes.forEach(w => {
          lessonMap[w.lesson] = (lessonMap[w.lesson] || 0) + 1;
        });

        const sortedLessons = Object.entries(lessonMap).sort((a, b) => b[1] - a[1]);

        recContainer.innerHTML = `
          <div class="bg-rose-950/40 border border-rose-800/70 rounded-2xl p-4 space-y-3 text-xs">
            <div class="flex items-center space-x-2 text-rose-300 font-bold">
              <span class="text-base">🎯</span>
              <span>পরামর্শ / Study Recommendations</span>
            </div>
            <p class="text-[11px] text-slate-300 leading-relaxed">
              কুইজে ভুল হওয়া শব্দগুলোর ভিত্তিতে নিচের দুর্বল লেসনগুলো বেশি করে রিভিশন দিন:
            </p>
            <div class="space-y-2 pt-1">
              ${sortedLessons.map(([lNum, count]) => `
                <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm">
                  <div>
                    <span class="font-bold text-slate-200">Lesson ${lNum}</span>
                    <span class="text-rose-400 font-medium text-[11px] ml-1.5">(${count}টি ভুল)</span>
                  </div>
                  <button onclick="window.handleFcLessonSelect(${lNum}); window.switchTab('flashcard');" class="px-2.5 py-1 bg-sky-950 text-sky-300 border border-sky-800/80 rounded-lg text-[11px] font-bold hover:bg-sky-900 transition shadow-sm">
                    📖 ফ্লাসকার্ড রিভিশন
                  </button>
                </div>
              `).join('')}
            </div>
            <button onclick="window.startQuizWithMistakes()" class="w-full mt-2 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-xs shadow-lg transition active:scale-98">
              🔴 শুধুমাত্র ভুল হওয়া ${quizMistakes.length}টি শব্দ নিয়ে রি-টেস্ট দিন
            </button>
          </div>
        `;
      } else {
        recContainer.innerHTML = `
          <div class="bg-emerald-950/40 border border-emerald-800/70 rounded-2xl p-4 text-xs text-emerald-300 flex items-start space-x-3 shadow-lg">
            <span class="text-2xl">🌟</span>
            <div>
              <strong class="block text-sm font-bold text-emerald-200 mb-0.5">১০০% পারফেক্ট স্কোর!</strong>
              <p class="text-[11px] text-slate-300 leading-relaxed">একটি শব্দও ভুল হয়নি। আপনি আপনার পড়া চমৎকারভাবে আয়ত্ত করেছেন। পরবর্তী লেসনে এগিয়ে যান!</p>
            </div>
          </div>
        `;
      }
    }
  }

  window.startQuizWithMistakes = function () {
    if (quizMistakes.length === 0) return;
    initQuiz([...quizMistakes]);
  };

  // Render Dashboard
  function renderDashboard() {
    const container = document.getElementById('view-dashboard');
    if (!container) return;

    const totalWords = allWords.length;
    let easyCount = 0;
    let goodCount = 0;
    let hardCount = 0;

    Object.values(srsData).forEach(srs => {
      if (srs.level === 'easy') easyCount++;
      else if (srs.level === 'good') goodCount++;
      else if (srs.level === 'hard') hardCount++;
    });

    const reviewedCount = easyCount + goodCount + hardCount;
    const newCount = Math.max(0, totalWords - reviewedCount);

    // Calculate overall mastery percentage
    const masteryPct = totalWords > 0 ? Math.round(((easyCount + goodCount * 0.5) / totalWords) * 100) : 0;

    // Hard words list for spotlight
    const hardWords = allWords.filter(w => srsData[w.id] && srsData[w.id].level === 'hard');

    // Lesson-wise breakdown
    const lessonStats = [];
    for (let l = 1; l <= 15; l++) {
      const lWords = allWords.filter(w => w.lesson === l);
      if (lWords.length === 0) continue;
      
      let lEasy = 0, lGood = 0, lHard = 0;
      lWords.forEach(w => {
        const s = srsData[w.id];
        if (s) {
          if (s.level === 'easy') lEasy++;
          else if (s.level === 'good') lGood++;
          else if (s.level === 'hard') lHard++;
        }
      });
      const lReviewed = lEasy + lGood + lHard;
      const lPct = lWords.length > 0 ? Math.round(((lEasy + lGood * 0.5) / lWords.length) * 100) : 0;
      lessonStats.push({
        lesson: l,
        total: lWords.length,
        reviewed: lReviewed,
        easy: lEasy,
        good: lGood,
        hard: lHard,
        pct: lPct
      });
    }

    // Generate Dashboard HTML
    container.innerHTML = `
      <!-- Hero Overview Banner -->
      <div class="bg-gradient-to-br from-slate-900 via-slate-850 to-sky-950/80 border border-slate-800 rounded-3xl p-5 shadow-2xl relative overflow-hidden">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-wider text-sky-400 px-2.5 py-0.5 rounded-full bg-sky-950 border border-sky-800/80">
              📊 Study Progress & Feedback
            </span>
            <h2 class="text-xl font-bold text-white mt-1.5">পড়ার অগ্রগতি ড্যাসবোর্ড</h2>
            <p class="text-xs text-slate-400 mt-0.5 font-bangla">
              ফ্ল্যাmashtক ও কুইজে আপনার পারফরম্যান্সের ওপর ভিত্তি করে তৈরি ট্র্যাকার
            </p>
          </div>
          <!-- Overall Circle Progress Pill -->
          <div class="w-16 h-16 rounded-2xl bg-slate-900/90 border border-sky-500/30 flex flex-col items-center justify-center shadow-lg shadow-sky-500/10">
            <span class="text-lg font-black text-sky-400 leading-none">${masteryPct}%</span>
            <span class="text-[9px] text-slate-400 font-bold mt-0.5 uppercase">Mastery</span>
          </div>
        </div>

        <!-- Overall Progress Bar -->
        <div class="mt-4">
          <div class="flex justify-between text-xs text-slate-300 font-medium mb-1 font-bangla">
            <span>মোট রিভিউ: <strong class="text-emerald-400">${reviewedCount}</strong> / ${totalWords} শব্দ</span>
            <span class="text-sky-400 font-bold">${masteryPct}% সম্পূর্ণ</span>
          </div>
          <div class="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
            <div style="width: ${totalWords > 0 ? (easyCount / totalWords) * 100 : 0}%" class="bg-emerald-400 transition-all duration-500" title="Easy / Mastered"></div>
            <div style="width: ${totalWords > 0 ? (goodCount / totalWords) * 100 : 0}%" class="bg-amber-400 transition-all duration-500" title="Good / Learning"></div>
            <div style="width: ${totalWords > 0 ? (hardCount / totalWords) * 100 : 0}%" class="bg-rose-500 transition-all duration-500" title="Hard / Needs Review"></div>
          </div>
        </div>
      </div>

      <!-- 4 Stat Mastery Cards Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-bangla">
        <!-- Card 1: Easy / Mastered -->
        <div class="bg-emerald-950/30 border border-emerald-800/50 rounded-2xl p-3.5 shadow-lg relative overflow-hidden">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-emerald-400">🟢 মাস্তারি করা</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 font-mono">
              ${totalWords > 0 ? Math.round((easyCount / totalWords) * 100) : 0}%
            </span>
          </div>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-2xl font-black text-white">${easyCount}</span>
            <span class="text-[11px] text-slate-400">টি শব্দ</span>
          </div>
          <p class="text-[10px] text-emerald-400/80 mt-1">সহজ মনে রাখা শব্দসমূহ</p>
        </div>

        <!-- Card 2: Good / Learning -->
        <div class="bg-amber-950/30 border border-amber-800/50 rounded-2xl p-3.5 shadow-lg relative overflow-hidden">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-amber-400">🟡 মোটামুটি আয়ত্ত</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 border border-amber-700/50 font-mono">
              ${totalWords > 0 ? Math.round((goodCount / totalWords) * 100) : 0}%
            </span>
          </div>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-2xl font-black text-white">${goodCount}</span>
            <span class="text-[11px] text-slate-400">টি শব্দ</span>
          </div>
          <p class="text-[10px] text-amber-400/80 mt-1">আরও অনুশীলনে ভালো হবে</p>
        </div>

        <!-- Card 3: Hard / Need Focus -->
        <div class="bg-rose-950/30 border border-rose-800/50 rounded-2xl p-3.5 shadow-lg relative overflow-hidden">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-rose-400">🔴 কঠিন শব্দ</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 border border-rose-700/50 font-mono">
              ${totalWords > 0 ? Math.round((hardCount / totalWords) * 100) : 0}%
            </span>
          </div>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-2xl font-black text-white">${hardCount}</span>
            <span class="text-[11px] text-slate-400">টি শব্দ</span>
          </div>
          <p class="text-[10px] text-rose-400/80 mt-1">বিশেষ নজর দেওয়া দরকার</p>
        </div>

        <!-- Card 4: New / Unstudied -->
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-lg relative overflow-hidden">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-300">⚪ পড়া বাকি</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
              ${totalWords > 0 ? Math.round((newCount / totalWords) * 100) : 0}%
            </span>
          </div>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-2xl font-black text-white">${newCount}</span>
            <span class="text-[11px] text-slate-400">টি শব্দ</span>
          </div>
          <p class="text-[10px] text-slate-400 mt-1">নতুন পড়া শুরু করুন</p>
        </div>
      </div>

      <!-- Spotlight Section: Hard Words Focus Area -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div class="flex items-center space-x-2">
            <span class="text-base">🎯</span>
            <div>
              <h3 class="text-sm font-bold text-white font-bangla">কঠিন শব্দের স্পটলাইট (Hard Words Review)</h3>
              <p class="text-[11px] text-slate-400 font-bangla">যে শব্দগুলো আপানার কাছে কঠিন মনে হচ্ছে সেগুলো একসাথে রিভিশন দিন</p>
            </div>
          </div>
          <span class="text-xs px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800/60 font-bold">
            ${hardWords.length} Words
          </span>
        </div>

        ${hardWords.length > 0 ? `
          <div class="space-y-2 max-h-60 overflow-y-auto pr-1">
            ${hardWords.slice(0, 6).map(item => `
              <div class="bg-slate-850 border border-rose-900/40 rounded-xl p-2.5 flex items-center justify-between hover:border-rose-700/60 transition">
                <div class="flex items-center space-x-2.5">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-sky-400 border border-slate-700">L${item.lesson}</span>
                  <div>
                    <div class="text-sm font-bold text-white font-japanese">
                      ${item.kanji} ${item.furigana && item.furigana !== item.kanji ? `<span class="text-xs text-sky-400">(${item.furigana})</span>` : ''}
                    </div>
                    <div class="text-[11px] text-slate-300 font-bangla">
                      ${escapeHtml(item.en)} / <span class="text-emerald-400 font-semibold">${escapeHtml(item.bn)}</span>
                    </div>
                  </div>
                </div>
                <div class="flex items-center space-x-1">
                  <button onclick="window.playAudio('${item.kanji.replace(/'/g, "\\'")}')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-sky-950 text-sky-400 transition" title="Listen">
                    🔊
                  </button>
                  <button onclick="window.copyWordCard(event, ${item.id})" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition" title="Copy">
                    📋
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
          <button onclick="window.startHardWordsFlashcards()" class="w-full py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 text-white font-bold text-xs shadow-lg transition active:scale-98 flex items-center justify-center space-x-1.5 font-bangla">
            <span>🔀</span>
            <span>কঠিন শব্দগুলো ফ্ল্যাশকার্ডে প্র্যাকটিস করুন (${hardWords.length}টি)</span>
          </button>
        ` : `
          <div class="text-center py-5 bg-slate-850/60 rounded-xl border border-slate-800 font-bangla">
            <div class="text-3xl mb-1">🎉</div>
            <p class="text-xs font-semibold text-slate-300">কোনো "কঠিন শব্দ" চিহ্নিত নেই!</p>
            <p class="text-[11px] text-slate-500 mt-0.5">ফ্ল্যাশকার্ডে পড়ার সময় না পারলে 🔴 "Hard" বাটন চাপুন।</p>
            <button onclick="window.switchTab('flashcard')" class="mt-3 px-3.5 py-1.5 rounded-xl bg-sky-950 text-sky-400 border border-sky-800/60 text-xs font-bold hover:bg-sky-900 transition">
              ফ্ল্যাশকার্ডে পড়া শুরু করুন →
            </button>
          </div>
        `}
      </div>

      <!-- Quick Shortcuts Hub -->
      <div class="grid grid-cols-2 gap-2">
        <button onclick="window.switchTab('flashcard')" class="p-3 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-sky-500/40 text-left transition flex items-center space-x-3 group">
          <div class="w-10 h-10 rounded-xl bg-sky-950 border border-sky-800 flex items-center justify-center text-sky-400 text-lg group-hover:scale-110 transition">
            🗂️
          </div>
          <div>
            <div class="text-xs font-bold text-white">ফ্ল্যাশকার্ড</div>
            <div class="text-[10px] text-slate-400 font-bangla">স্মৃতি মেমোরি টেস্ট</div>
          </div>
        </button>

        <button onclick="window.switchTab('quiz')" class="p-3 rounded-2xl bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-emerald-500/40 text-left transition flex items-center space-x-3 group">
          <div class="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400 text-lg group-hover:scale-110 transition">
            🎯
          </div>
          <div>
            <div class="text-xs font-bold text-white">কুইজ টেস্ট</div>
            <div class="text-[10px] text-slate-400 font-bangla">যাচাই করে দেখুন</div>
          </div>
        </button>
      </div>

      <!-- Lesson-wise Progress Breakdown -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-xl">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div>
            <h3 class="text-sm font-bold text-white font-bangla">লেসন ভিত্তিক অগ্রগতি (Lessons 1–15)</h3>
            <p class="text-[11px] text-slate-400 font-bangla">আপনার লেসন ট্র্যাকিং মনিটর</p>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800 font-bold">
            L1–L15
          </span>
        </div>

        <div class="space-y-2">
          ${lessonStats.map(ls => `
            <div onclick="window.filterByCanDoLesson(${ls.lesson})" class="cursor-pointer bg-slate-850 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 rounded-xl p-2.5 transition">
              <div class="flex items-center justify-between mb-1 text-xs">
                <div class="flex items-center space-x-2">
                  <span class="font-bold text-sky-400 bg-sky-950 px-2 py-0.5 rounded border border-sky-800/60">
                    Lesson ${ls.lesson}
                  </span>
                  <span class="text-slate-300 font-medium font-bangla">${ls.reviewed} / ${ls.total} শব্দ পড়া হয়েছে</span>
                </div>
                <span class="font-bold font-mono text-emerald-400">${ls.pct}%</span>
              </div>
              
              <!-- Progress Bar -->
              <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden flex">
                <div style="width: ${ls.total > 0 ? (ls.easy / ls.total) * 100 : 0}%" class="bg-emerald-400"></div>
                <div style="width: ${ls.total > 0 ? (ls.good / ls.total) * 100 : 0}%" class="bg-amber-400"></div>
                <div style="width: ${ls.total > 0 ? (ls.hard / ls.total) * 100 : 0}%" class="bg-rose-500"></div>
              </div>

              <div class="flex items-center justify-between mt-1 text-[10px] text-slate-400 font-bangla">
                <div class="flex space-x-2">
                  <span class="text-emerald-400 font-semibold">🟢 ${ls.easy}</span>
                  <span class="text-amber-400 font-semibold">🟡 ${ls.good}</span>
                  <span class="text-rose-400 font-semibold">🔴 ${ls.hard}</span>
                </div>
                <span class="text-sky-400 hover:underline">পড়তে ট্যাপ করুন →</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Render Can-Do Curriculum Goals
  function renderCanDoGoals() {
    const container = document.getElementById('cando-container');
    if (!container || !window.CAN_DO_GOALS) return;

    container.innerHTML = window.CAN_DO_GOALS.map(item => `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg">
        <div class="flex items-center justify-between mb-2">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-950 text-sky-400 border border-sky-800/60">
            第${item.lesson}課
          </span>
          <button onclick="window.filterByCanDoLesson(${item.lesson})" class="text-xs text-sky-400 hover:text-sky-300 flex items-center space-x-1 font-semibold">
            <span>Study Words</span>
            <span>→</span>
          </button>
        </div>
        <h3 class="font-bold text-white text-sm mb-1">${item.title} <span class="text-xs text-slate-400 font-normal">(${item.titleEn})</span></h3>
        <p class="text-xs text-slate-300 leading-relaxed font-japanese mb-2 bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/50">
          🎯 ${item.goalJp}
        </p>
        <p class="text-[11px] text-slate-400 italic">
          ${item.goalEn}
        </p>
      </div>
    `).join('');
  }

  // Persistent tab scroll position cache to remember scroll states
  const tabScrollPositions = {};

  // Global Handlers attached to window
  window.switchTab = function (tab) {
    // 1. Save scroll position of current tab before switching
    if (activeTab) {
      tabScrollPositions[activeTab] = window.scrollY;
    }

    activeTab = tab;
    if (tab !== 'quiz') {
      stopQuizTimer();
    }
    const views = ['dashboard', 'list', 'flashcard', 'quiz', 'cando'];
    views.forEach(v => {
      const viewEl = document.getElementById(`view-${v}`);
      const tabEl = document.getElementById(`tab-${v}`);
      if (viewEl) {
        if (v === tab) {
          viewEl.classList.remove('hidden');
        } else {
          viewEl.classList.add('hidden');
        }
      }
      if (tabEl) {
        if (v === tab) {
          tabEl.className = 'tab-btn flex-1 flex flex-col items-center py-1 text-sky-400 transition';
        } else {
          tabEl.className = 'tab-btn flex-1 flex flex-col items-center py-1 text-slate-500 hover:text-slate-300 transition';
        }
      }
    });

    if (tab === 'dashboard') {
      renderDashboard();
    } else if (tab === 'flashcard') {
      initFlashcards();
    } else if (tab === 'quiz') {
      initQuiz();
    } else if (tab === 'cando') {
      renderCanDoGoals();
    }

    // 2. Restore scroll position of the target tab
    const targetScrollY = tabScrollPositions[tab] || 0;
    setTimeout(() => {
      window.scrollTo({ top: targetScrollY, behavior: 'auto' });
    }, 0);
  };

  window.loadMoreWords = function () {
    wordListVisibleCount += 15;
    filterVocabulary(false); // false means keep current pagination limit
  };

  window.handleSearchInput = function (val) {
    searchKeyword = val;
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) {
      if (val.trim()) clearBtn.classList.remove('hidden');
      else clearBtn.classList.add('hidden');
    }
    filterVocabulary();
  };

  window.clearSearch = function () {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    searchKeyword = '';
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.classList.add('hidden');
    filterVocabulary();
  };

  window.handleLessonChange = function (val) {
    currentLesson = parseInt(val, 10) || 0;
    filterVocabulary();
    if (activeTab === 'flashcard') initFlashcards();
    if (activeTab === 'quiz') initQuiz();
  };

  window.setFilterCategory = function (cat) {
    activeFilterChip = cat;
    const chips = ['all', 'fav', 'due', 'hard'];
    chips.forEach(c => {
      const btn = document.getElementById(`chip-${c}`);
      if (btn) {
        if (c === cat) {
          btn.className = 'filter-chip py-1.5 px-2 rounded-xl font-medium text-center bg-sky-500/20 text-sky-300 border border-sky-500/40 text-[11px] truncate shadow-sm';
        } else {
          btn.className = 'filter-chip py-1.5 px-2 rounded-xl font-medium text-center bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700 text-[11px] truncate';
        }
      }
    });
    filterVocabulary();
  };

  window.resetFilters = function () {
    currentLesson = 1;
    searchKeyword = '';
    activeFilterChip = 'all';
    const lSelect = document.getElementById('lesson-select');
    if (lSelect) lSelect.value = '1';
    const sInput = document.getElementById('search-input');
    if (sInput) sInput.value = '';
    window.setFilterCategory('all');
  };

  window.toggleFavorite = function (id) {
    if (favorites.has(id)) {
      favorites.delete(id);
    } else {
      favorites.add(id);
    }
    saveFavorites();
    filterVocabulary(false);
    if (activeTab === 'flashcard') {
      const currentItem = fcList[fcIndex];
      if (currentItem && currentItem.id === id) {
        renderCurrentFlashcard();
      }
    }
  };

  window.toggleCardFavorite = function (e) {
    if (e) e.stopPropagation();
    if (fcList.length > 0) {
      const item = fcList[fcIndex];
      window.toggleFavorite(item.id);
    }
  };

  function syncDisplayToggleButtons() {
    const fToggle = document.getElementById('toggle-list-furigana');
    if (fToggle) fToggle.checked = showFurigana;
    const rToggle = document.getElementById('toggle-list-romaji');
    if (rToggle) rToggle.checked = showRomaji;
    const eToggle = document.getElementById('toggle-list-english');
    if (eToggle) eToggle.checked = showEnglish;
    const bToggle = document.getElementById('toggle-list-bangla');
    if (bToggle) bToggle.checked = showBangla;

    const fcFuriganaBtn = document.getElementById('fc-btn-toggle-furigana');
    if (fcFuriganaBtn) {
      fcFuriganaBtn.className = showFurigana
        ? 'py-1.5 px-2 bg-sky-950/80 text-sky-400 border border-sky-700/80 rounded-xl text-xs font-bold transition flex items-center justify-center shadow-sm'
        : 'py-1.5 px-2 bg-slate-800 hover:bg-slate-750 text-slate-500 border border-slate-700/80 rounded-xl text-xs font-bold transition flex items-center justify-center line-through';
    }

    const fcRomajiBtn = document.getElementById('fc-btn-toggle-romaji');
    if (fcRomajiBtn) {
      fcRomajiBtn.className = showRomaji
        ? 'py-1.5 px-2 bg-sky-950/80 text-sky-400 border border-sky-700/80 rounded-xl text-[11px] font-bold transition flex items-center justify-center shadow-sm'
        : 'py-1.5 px-2 bg-slate-800 hover:bg-slate-750 text-slate-500 border border-slate-700/80 rounded-xl text-[11px] font-bold transition flex items-center justify-center line-through';
    }

    const fcEnBtn = document.getElementById('fc-btn-toggle-en');
    if (fcEnBtn) {
      fcEnBtn.className = showEnglish
        ? 'py-1.5 px-2 bg-sky-950/80 text-sky-400 border border-sky-700/80 rounded-xl text-[11px] font-bold transition flex items-center justify-center shadow-sm'
        : 'py-1.5 px-2 bg-slate-800 hover:bg-slate-750 text-slate-500 border border-slate-700/80 rounded-xl text-[11px] font-bold transition flex items-center justify-center line-through';
    }

    const fcBnBtn = document.getElementById('fc-btn-toggle-bn');
    if (fcBnBtn) {
      fcBnBtn.className = showBangla
        ? 'py-1.5 px-2 bg-emerald-950/80 text-emerald-400 border border-emerald-700/80 rounded-xl text-[11px] font-bold font-bangla transition flex items-center justify-center shadow-sm'
        : 'py-1.5 px-2 bg-slate-800 hover:bg-slate-750 text-slate-500 border border-slate-700/80 rounded-xl text-[11px] font-bold font-bangla transition flex items-center justify-center line-through';
    }
  }

  window.toggleListFurigana = function (checked) {
    showFurigana = checked;
    saveSettings();
    syncDisplayToggleButtons();
    renderWordList();
    if (activeTab === 'flashcard') renderCurrentFlashcard();
  };

  window.toggleListRomaji = function (checked) {
    showRomaji = checked;
    saveSettings();
    syncDisplayToggleButtons();
    renderWordList();
    if (activeTab === 'flashcard') renderCurrentFlashcard();
  };

  window.toggleListEnglish = function (checked) {
    showEnglish = checked;
    saveSettings();
    syncDisplayToggleButtons();
    renderWordList();
    if (activeTab === 'flashcard') renderCurrentFlashcard();
  };

  window.toggleListBangla = function (checked) {
    showBangla = checked;
    saveSettings();
    syncDisplayToggleButtons();
    renderWordList();
    if (activeTab === 'flashcard') renderCurrentFlashcard();
  };

  window.toggleFlashcardSetting = function (type) {
    if (type === 'furigana') {
      showFurigana = !showFurigana;
    } else if (type === 'romaji') {
      showRomaji = !showRomaji;
    } else if (type === 'english') {
      showEnglish = !showEnglish;
    } else if (type === 'bangla') {
      showBangla = !showBangla;
    }
    saveSettings();
    syncDisplayToggleButtons();
    renderCurrentFlashcard();
    renderWordList();
  };

  window.revealCardText = function (e, id, lang) {
    if (e) e.stopPropagation();
    revealedWords.add(`${id}_${lang}`);
    const item = allWords.find(w => w.id === id);
    if (!item) return;
    const rowEl = document.getElementById(`word-trans-${lang}-${id}`);
    if (rowEl) {
      rowEl.innerHTML = lang === 'en' ? getEnRowHtml(item) : getBnRowHtml(item);
    }
  };

  window.hideCardText = function (e, id, lang) {
    if (e) e.stopPropagation();
    revealedWords.delete(`${id}_${lang}`);
    const item = allWords.find(w => w.id === id);
    if (!item) return;
    const rowEl = document.getElementById(`word-trans-${lang}-${id}`);
    if (rowEl) {
      rowEl.innerHTML = lang === 'en' ? getEnRowHtml(item) : getBnRowHtml(item);
    }
  };

  window.toggleCardFuriganaPeek = function (e, id) {
    if (e) e.stopPropagation();
    const rubyEl = document.getElementById(`ruby-${id}`);
    if (rubyEl) {
      rubyEl.classList.toggle('peek-ruby');
    }
  };

  window.revealFcMeaning = function (e, lang) {
    if (e) e.stopPropagation();
    if (lang === 'en') fcRevealedEn = true;
    if (lang === 'bn') fcRevealedBn = true;
    renderCurrentFlashcard();
  };

  window.hideFcMeaning = function (e, lang) {
    if (e) e.stopPropagation();
    if (lang === 'en') fcRevealedEn = false;
    if (lang === 'bn') fcRevealedBn = false;
    renderCurrentFlashcard();
  };

  window.toggleAudioSpeed = function () {
    if (audioSpeed === 0.9) audioSpeed = 1.0;
    else if (audioSpeed === 1.0) audioSpeed = 0.75;
    else audioSpeed = 0.9;

    const label = document.getElementById('speed-label');
    if (label) label.textContent = `${audioSpeed}x`;
    saveSettings();
  };

  // Toast Notification for Copy feedback
  function showToast(msg) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'fixed bottom-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-slate-800/95 border border-sky-500/50 text-sky-300 text-xs font-semibold shadow-2xl transition-all duration-300 opacity-0 pointer-events-none transform translate-y-2';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
    toast.classList.add('opacity-100', 'translate-y-0');
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
      toast.classList.remove('opacity-100', 'translate-y-0');
    }, 2000);
  }

  function fallbackCopy(text, label) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showToast(`📋 ${label || 'কপি করা হয়েছে'}: ${text}`);
    } catch (err) {
      showToast('❌ কপি করা যায়নি');
    }
    document.body.removeChild(textArea);
  }

  window.copyText = function (e, text, label) {
    if (e) e.stopPropagation();
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(`📋 ${label || 'কপি করা হয়েছে'}: ${text}`);
      }).catch(() => {
        fallbackCopy(text, label);
      });
    } else {
      fallbackCopy(text, label);
    }
  };

  window.copyWordCard = function (e, id) {
    if (e) e.stopPropagation();
    const item = allWords.find(w => w.id === id);
    if (!item) return;
    let text = item.kanji;
    if (item.furigana && item.furigana !== item.kanji) {
      text += ` [${item.furigana}]`;
    }
    if (item.romaji) {
      text += ` (${item.romaji})`;
    }
    const meanings = [];
    if (item.en) meanings.push(item.en);
    if (item.bn) meanings.push(item.bn);
    if (meanings.length > 0) {
      text += ` - ${meanings.join(' / ')}`;
    }
    window.copyText(e, text, 'শব্দ কপি করা হয়েছে');
  };

  window.copyCurrentFlashcard = function (e) {
    if (e) e.stopPropagation();
    if (fcList.length > 0) {
      const item = fcList[fcIndex];
      let text = item.kanji;
      if (item.furigana && item.furigana !== item.kanji) {
        text += ` [${item.furigana}]`;
      }
      if (item.romaji) {
        text += ` (${item.romaji})`;
      }
      const meanings = [];
      if (item.en) meanings.push(item.en);
      if (item.bn) meanings.push(item.bn);
      if (meanings.length > 0) {
        text += ` - ${meanings.join(' / ')}`;
      }
      window.copyText(e, text, 'কার্ড কপি করা হয়েছে');
    }
  };

  window.playAudio = playAudio;

  window.playCurrentCardAudio = function (e) {
    if (e) e.stopPropagation();
    if (fcList.length > 0) {
      playAudio(fcList[fcIndex].kanji);
    }
  };

  window.playQuizAudio = function () {
    if (quizWords.length > 0 && quizWords[quizIndex]) {
      playAudio(quizWords[quizIndex].kanji);
    }
  };

  window.flipCurrentCard = handleCardClick;
  window.handleCardClick = handleCardClick;
  window.revealCardAnswer = revealCardAnswer;
  window.hideCardAnswer = hideCardAnswer;
  window.handleFcLessonSelect = handleFcLessonSelect;
  window.toggleFcQuickFurigana = toggleFcQuickFurigana;
  window.navigateFlashcard = navigateFlashcard;
  window.shuffleFlashcards = shuffleFlashcards;
  window.handleSrsRating = handleSrsRating;
  window.handleQuizAnswer = handleQuizAnswer;
  window.nextQuizQuestion = nextQuizQuestion;
  window.startNewQuiz = initQuiz;
  window.resetQuiz = initQuiz;

  window.confirmResetSrsData = function () {
    if (confirm('আপনি কি নিশ্চিত যে পড়ার সমস্ত অগ্রগতি রিসেট করতে চান? (Are you sure you want to reset all study progress?)')) {
      srsData = {};
      saveSrs();
      favorites.clear();
      saveFavorites();
      sessionQuizAskedIds.clear();
      quizMistakes = [];

      filterVocabulary();
      renderDashboard();
      if (activeTab === 'flashcard') initFlashcards();
      if (activeTab === 'quiz') initQuiz();

      showToast('🔄 পড়ার অগ্রগতি সফলভাবে রিসেট করা হয়েছে');
    }
  };

  window.startHardWordsFlashcards = function () {
    activeFilterChip = 'hard';
    fcCurrentLesson = 0;
    window.switchTab('flashcard');
  };

  window.filterByCanDoLesson = function (lessonNum) {
    currentLesson = lessonNum;
    const lSelect = document.getElementById('lesson-select');
    if (lSelect) lSelect.value = String(lessonNum);
    window.switchTab('list');
    filterVocabulary();
  };

  // --- PWA (Progressive Web App) Installation & Offline Support ---
  let pwaDeferredPrompt = null;

  window.triggerPWAInstall = async function() {
    if (pwaDeferredPrompt) {
      pwaDeferredPrompt.prompt();
      const { outcome } = await pwaDeferredPrompt.userChoice;
      if (outcome === 'accepted') {
        pwaDeferredPrompt = null;
        togglePwaInstallButton(false);
        showToast('🎉 অ্যাপটি সফলভাবে ইনস্টল করা হচ্ছে!');
      }
    } else if (isIosDevice()) {
      const iosGuide = document.getElementById('ios-install-dialog');
      if (iosGuide) iosGuide.classList.remove('hidden');
    }
  };

  window.closeIosInstallGuide = function() {
    const iosGuide = document.getElementById('ios-install-dialog');
    if (iosGuide) iosGuide.classList.add('hidden');
  };

  function isIosDevice() {
    return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
  }

  function togglePwaInstallButton(show) {
    const btn = document.getElementById('pwa-install-btn');
    if (!btn) return;
    if (show) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  function setupPwaEvents() {
    // 1. Listen for installability
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      pwaDeferredPrompt = e;
      togglePwaInstallButton(true);
    });

    // 2. Hide prompt if already installed or launched as standalone PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
      togglePwaInstallButton(false);
    } else if (isIosDevice()) {
      togglePwaInstallButton(true);
    }

    // 3. Success callback on app installed
    window.addEventListener('appinstalled', () => {
      pwaDeferredPrompt = null;
      togglePwaInstallButton(false);
      showToast('💖 できる日本語 Vocabulary এখন আপনার ফোনে ইনস্টলড!');
    });

    // 4. Online / Offline state indicators
    const banner = document.getElementById('offline-banner');
    
    function updateOnlineStatus() {
      if (navigator.onLine) {
        if (banner) banner.classList.add('hidden');
      } else {
        if (banner) banner.classList.remove('hidden');
      }
    }

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus(); // Initial check
  }

  // Initialization when DOM and data are ready
  function initApp() {
    loadSavedData();

    // Fetch vocabulary from master window array
    allWords = window.VOCABULARY || [];
    filteredWords = [...allWords];

    // Dynamic Copyright Year
    const copyYearEl = document.getElementById('copyright-year');
    if (copyYearEl) copyYearEl.textContent = String(new Date().getFullYear());

    // Set Speed Label
    const speedLabel = document.getElementById('speed-label');
    if (speedLabel) speedLabel.textContent = `${audioSpeed}x`;

    syncDisplayToggleButtons();

    filterVocabulary();
    renderCanDoGoals();
    renderDashboard();

    setupPwaEvents();

    // Default to Dashboard view
    window.switchTab('dashboard');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
