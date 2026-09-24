---
id: projects
name: {is: Verkefni, en: "Projects portfolio"}
domain: 12
owner: engine
status: hidden
flag: modules.projects.enabled
paths:
  - server/routes/projectRoutes.js
  - server/controllers/projectController.js
  - server/models/Project.js
  - server/utils/youtube.js
  - public/js/views/ProjectsView.js
  - public/js/views/ProjectDetailView.js
  - public/js/components/ProjectCard.js
  - public/js/components/ProjectForm.js
  - public/js/components/ProjectModal.js
  - public/js/api/projectApi.js
  - server/scripts/update-portfolio-project.js
  - server/scripts/seed-arnarhraun.js
  - server/scripts/seed-stofan-bakhus.js
  - public/css/gallery.css
  - public/css/project-edit.css
  - tests/integration/projects.test.js
  - tests/integration/sections.test.js
  - tests/integration/videos.test.js
  - e2e/gallery.spec.js
  - e2e/project-edit.spec.js
migrations: [004_project_media, 013_project_sections, 014_project_section_description, 015_project_videos]
since: 2026-08-09
origin: null
history: [r1, harvest-2]
---

Case studies / portfolio projects with media galleries (004), sections (013/014) and YouTube videos (015), edited inline by admins. `/verkefni` and `/projects` are hidden here since 2026-09-03; the admin board is `admin-shell`'s `AdminProjectsView`.

**Rules**
- Slug folding applies on GENERATION only; stored slugs never change.
- Full rules: [../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio](../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio).
