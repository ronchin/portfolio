document.addEventListener('DOMContentLoaded', () => {
    // Reveal animazione "stagger"
    const items = document.querySelectorAll('.item');
    const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const i = [...items].indexOf(entry.target);
                setTimeout(() => entry.target.classList.add('visible'), i * 120);
                obs.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });
    items.forEach(it => observer.observe(it));

    // Scroll-to-top
    const btn = document.querySelector('.scroll-top');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) btn.classList.add('visible');
        else btn.classList.remove('visible');
    });
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
});