// wwwroot/js/modules/comment-speaker.js

export function initCommentSpeaker() {
    // 1画面で1回だけ実行（重複防止）
    if (window.__commentSpoken) return;

    const labels = Array.from(document.querySelectorAll('.itemlabel'));
    const commentLabel = labels.find(el => el.textContent.trim() === 'コメント');

    if (!commentLabel) return;

    const valueEl = commentLabel.nextElementSibling;
    if (valueEl && valueEl.classList.contains('itemvalue')) {
        const text = valueEl.textContent.trim();

        if (text) {
            window.__commentSpoken = true;

            // 即座にSpeechSynthesisを呼び出す
            const speakNow = () => {
                // 発言キューをリセット（連続遷移時の詰まり防止）
                window.speechSynthesis.cancel();

                const uttr = new SpeechSynthesisUtterance(text);
                uttr.lang = 'ja-JP';
                uttr.rate = 1.0;  // 読み上げ速度（1.0 = 標準）
                uttr.pitch = 1.0; // 声の高さ

                window.speechSynthesis.speak(uttr);
            };

            // ほんの少しだけ遅延させてDOMの安定を待ってから発声
            setTimeout(speakNow, 300);
        }
    }
}