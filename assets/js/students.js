/* Shared student data for the directory and individual profile pages. */
(() => {
  const scriptURL = document.currentScript.src;
  const siteURL = new URL("../../", scriptURL);
  const dataURL = new URL("../data/students.json", scriptURL);
  const list = document.querySelector("[data-students]");
  const visitingList = document.querySelector("[data-visiting]");
  const postdocList = document.querySelector("[data-postdocs]");
  const profile = document.querySelector("[data-student-profile]");
  const profileLinkTypes = {
    linkedin: { label: "LinkedIn", icon: "linkedin" },
    github: { label: "GitHub", icon: "github" },
    "google-scholar": { label: "Google Scholar", icon: "google-scholar" },
    orcid: { label: "ORCID", icon: "orcid" },
    website: { label: "Website", icon: "globe" },
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function linkStyle(link) {
    const type = link.type || link.label?.toLowerCase().replace(/\s+/g, "-");
    return Object.hasOwn(profileLinkTypes, type) ? profileLinkTypes[type] : {};
  }

  function linkLabel(link) {
    return (
      link.label || linkStyle(link).label || new URL(link.url, siteURL).hostname
    );
  }

  function profileLink(link) {
    const label = linkLabel(link);
    const style = linkStyle(link);
    const anchor = element("a", "profile-link");
    anchor.href = new URL(link.url, siteURL).href;
    if (style.icon) {
      anchor.className += " profile-link--icon";
      anchor.setAttribute("aria-label", label);
      anchor.title = label;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute(
        "href",
        new URL(`assets/img/profile-links.svg#${style.icon}`, siteURL).href,
      );
      svg.append(use);
      anchor.append(svg);
    } else {
      anchor.textContent = label;
    }
    return anchor;
  }

  function photo(student, isProfile = false) {
    const container = element(
      isProfile ? "div" : "span",
      isProfile ? "profile-photo" : "photo",
    );
    if (student.photo) {
      const image = element("img");
      image.src = new URL(student.photo.src, siteURL).href;
      image.alt = isProfile ? student.name : "";
      image.width = student.photo.width;
      image.height = student.photo.height;
      if (!isProfile) image.loading = "lazy";
      container.append(image);
    } else if (!isProfile) {
      container.append(element("span", "initials", student.initials));
    }
    return container;
  }

  function card(student) {
    const item = element("li", "person");
    const firstLink = student.links?.[0];
    const target = student.profilePath || firstLink?.url;
    const content = element(target ? "a" : "div");
    if (target) content.href = new URL(target, siteURL).href;
    content.append(photo(student), element("span", "name", student.name));
    item.append(content);
    return item;
  }

  function renderProfile(student) {
    document.title = `${student.name} | SAUSy Lab`;
    document.querySelector('meta[name="description"]').content =
      student.description || `${student.name}, SAUSy Lab.`;
    document.querySelector("[data-student-name]").textContent = student.name;

    const content = element("div");
    content.append(element("h1", "", student.name));
    if (student.profileRole || student.role) {
      content.append(element("p", "role", student.profileRole || student.role));
    }
    if (student.department)
      content.append(element("p", "dept", student.department));
    if (student.links?.length) {
      const links = element("p", "links");
      for (const link of student.links) {
        links.append(profileLink(link));
      }
      content.append(links);
    }

    const bio = element("div", "bio");
    for (const paragraph of student.bio || [])
      bio.append(element("p", "", paragraph));
    if (student.keywords?.length) {
      const keywords = element("p", "keywords");
      keywords.append(
        element("strong", "", "Keywords:"),
        ` ${student.keywords.join(", ")}`,
      );
      bio.append(keywords);
    }
    content.append(bio);
    profile.replaceChildren(photo(student, true), content);
  }

  async function loadStudents() {
    try {
      const response = await fetch(dataURL);
      if (!response.ok)
        throw new Error(`Student data returned HTTP ${response.status}`);
      const students = await response.json();
      if (list)
        list.replaceChildren(
          ...students.filter((person) => !person.group).map(card),
        );
      if (visitingList)
        visitingList.replaceChildren(
          ...students.filter((person) => person.group === "visiting").map(card),
        );
      if (postdocList)
        postdocList.replaceChildren(
          ...students
            .filter((person) => ["faculty", "postdoc"].includes(person.group))
            .map(card),
        );
      if (profile) {
        const student = students.find(
          (student) => student.id === profile.dataset.studentProfile,
        );
        if (!student) throw new Error("Student profile was not found");
        renderProfile(student);
      }
    } catch (error) {
      console.error("Unable to load student data:", error);
      const message =
        "Student information could not be loaded. Please refresh the page to try again.";
      if (list) list.replaceChildren(element("li", "", message));
      if (profile) profile.replaceChildren(element("p", "", message));
    }
  }

  loadStudents();
})();
