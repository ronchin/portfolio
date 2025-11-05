// Event function to recall function once window is resized
(function (sr) {
    let debounce = function (func, threshold, execAsap) {
        let timeout;
        return function debounced() {
            let obj = this, args = arguments;

            function delayed() {
                if (!execAsap)
                    func.apply(obj, args);
                timeout = null;
            };
            if (timeout)
                clearTimeout(timeout);
            else if (execAsap)
                func.apply(obj, args);

            timeout = setTimeout(delayed, threshold || 100);
        };
    };
    // smartresize
    window[sr] = function (fn) {
        return fn ? this.addEventListener('resize', debounce(fn)) : this.dispatchEvent(new Event(sr));
    };
})('smartresize');

// Window size variables
window.window_width = 0;
window.window_height = 0;
// Use clientWidth to exclude scrollbars and get actual viewport width
window.window_width = document.documentElement.clientWidth || window.innerWidth;
window.window_height = document.documentElement.clientHeight || window.innerHeight;

window.is_phone = (window.window_width < 816);
window.is_mobile = (window.window_width < 1024);
window.is_tablet = (window.window_width >= 768 && window.window_width < 1024);
window.is_desktop = (window.window_width >= 1024);
window.is_desktop_medium = (window.window_width < 1500);
window.is_desktop_large = (window.window_width >= 1200);
window.is_desktop_larger = (window.window_width >= 1500);
window.header_height = window.is_desktop ? 100 : 70;


// Function to update window size variables
const updateWindowSizes = () => {
    // Use clientWidth to exclude scrollbars and get actual viewport width
    window.window_width = document.documentElement.clientWidth || window.innerWidth;
    window.window_height = document.documentElement.clientHeight || window.innerHeight;

    window.is_phone = (window.window_width < 768);
    window.is_mobile = (window.window_width < 1024);
    window.is_tablet = (window.window_width >= 768 && window.window_width < 1024);
    window.is_desktop = (window.window_width >= 1024);
    window.is_desktop_medium = (window.window_width < 1500);
    window.is_desktop_large = (window.window_width >= 1200);
    window.is_desktop_larger = (window.window_width >= 1500);
}

//Anime.js - https://animejs.com/documentation/
const { animate, createTimeline, utils, createAnimatable, onScroll, text, stagger } = anime;

// Lenis.js - smooth scroller
const lenis = new Lenis({
    smoothWheel: true,
    anchors: {
        offset: - window.header_height,
    },
    smooth: true,
    lerp: 0.07,
    wheelMultiplier: 0.8,
});

lenis.on('scroll', () => {
    // Update the global header_height
    window.header_height = document.querySelector('header')?.getBoundingClientRect().height || window.header_height;
});

const raf = (time) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
};

requestAnimationFrame(raf);

// init callback to main functions
const init = () => {
    console.log('init');
    // Update window sizes to ensure correct values after DOM load
    updateWindowSizes();

}

// Document ready
window.addEventListener('DOMContentLoaded', () => {
    init();
});

// Update window sizes on resize
window.smartresize(updateWindowSizes);
