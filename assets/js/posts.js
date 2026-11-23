(() => {
  const picker = document.querySelector("[data-category-picker]");
  if (!picker) return;
  const buttons = [...picker.querySelectorAll("button")];
  const posts = [...document.querySelectorAll(".post-list li")];
  const years = [...document.querySelectorAll(".post-year")];
  const known = new Set(buttons.map((b) => b.dataset.category));

  function show(category) {
    if (!known.has(category)) category = "";
    for (const b of buttons) b.setAttribute("aria-pressed", b.dataset.category === category);
    for (const li of posts) li.hidden = category !== "" && li.dataset.category !== category;
    for (const section of years) {
      const empty = !section.querySelector(".post-list li:not([hidden])");
      section.hidden = empty;
      const link = document.querySelector(`[data-year="${section.id.replace("posts-", "")}"]`);
      if (link) link.hidden = empty;
    }
    const url = new URL(location.href);
    if (category) url.searchParams.set("category", category);
    else url.searchParams.delete("category");
    history.replaceState(null, "", url);
  }

  picker.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button) show(button.dataset.category);
  });
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".post-list .post-category a");
    if (!link) return;
    e.preventDefault();
    show(new URL(link.href).searchParams.get("category"));
    picker.scrollIntoView({ block: "nearest" });
  });

  picker.hidden = false;
  show(new URLSearchParams(location.search).get("category") || "");
})();
