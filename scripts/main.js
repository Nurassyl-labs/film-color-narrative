import { initIntroSection } from "./sections/intro.js";
import { initExploreSection } from "./sections/exploration.js";
import { initInteractionSection } from "./sections/interaction.js";
import { initReinterpretSection } from "./sections/reinterpret.js";

async function loadIncludes() {
  const containers = Array.from(document.querySelectorAll("[data-include]"));
  await Promise.all(
    containers.map(async (container) => {
      const url = container.getAttribute("data-include");
      if (!url) return;
      const response = await fetch(url);
      if (!response.ok) {
        container.innerHTML = "<section class=\"fc-section\"><div class=\"fc-panel\">Failed to load content</div></section>";
        return;
      }
      container.innerHTML = await response.text();
    })
  );
}

function setupObservers() {
  const sections = document.querySelectorAll("[data-section]");
  const navLinks = document.querySelectorAll(".fc-nav__link");
  const animTargets = document.querySelectorAll("[data-animate]");

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-inview");
        }
      });
    },
    { threshold: 0.15 }
  );

  animTargets.forEach((el) => observer.observe(el));

  let lastActiveNavId = null;

  const sectionToNavMap = {
    'intro': '#intro',
    'explore-avg': '#explore-avg',
    'explore-stack': '#explore-avg',
    'explore-metrics': '#explore-avg',
    'interaction-segments': '#interaction-segments',
    'interaction-emotion': '#interaction-segments',
    'reinterpret-single': '#reinterpret-single',
    'reinterpret-player': '#reinterpret-single'
  };

  const navObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const sectionId = entry.target.getAttribute("id");
          const navHref = sectionToNavMap[sectionId];
          
          if (navHref && navHref !== lastActiveNavId) {
            lastActiveNavId = navHref;
            navLinks.forEach((link) => {
              link.classList.toggle("is-active", link.getAttribute("href") === navHref);
            });
          }
        }
      });
    },
    { threshold: 0.05, rootMargin: "-10% 0px -80% 0px" }
  );

  sections.forEach((section) => navObserver.observe(section));
}

await loadIncludes();
setupObservers();
initIntroSection();
initExploreSection();
initInteractionSection();
initReinterpretSection();
