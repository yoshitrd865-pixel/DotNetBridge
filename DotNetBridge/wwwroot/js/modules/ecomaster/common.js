export function observeDOM(callback) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", callback);
    } else {
        callback();
    }

    const observer = new MutationObserver(() => callback());
    observer.observe(document.body, { childList: true, subtree: true });
}