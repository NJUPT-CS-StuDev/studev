// An Android browser is the one place the app has something to offer: say so once, quietly.
const KEY = 'studev_app_offer_closed';
const offer = document.querySelector<HTMLElement>('[data-app-offer]');
const installed = matchMedia('(display-mode: standalone)').matches;
let closed = true;
try { closed = localStorage.getItem(KEY) === '1'; } catch { /* Storage may be unavailable; stay quiet. */ }
if (offer && /Android/i.test(navigator.userAgent) && !installed && !closed) {
    offer.hidden = false;
    offer.querySelector('[data-app-offer-close]')?.addEventListener('click', () => {
        offer.hidden = true;
        try { localStorage.setItem(KEY, '1'); } catch { /* Closed for this page at least. */ }
    });
}
export {};
