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
history: [r1, harvest-2, admin-home-idag-2026-09-26]
---

Case studies / portfolio projects with media galleries (004), sections (013/014) and YouTube videos (015), edited inline by admins. `/verkefni` and `/projects` are hidden here since 2026-09-03; the admin board is `admin-shell`'s `AdminProjectsView`. Since 2026-09-26 the board has its own admin view id, `projects` (`server/auth/adminViews.js`), owned by this module (`moduleCatalog.js` `projects.adminViews`): switching the module off removes the view for everyone; the board is gated on `canSeeView('projects') || canEdit()`. It is a Vefur sidebar line, hidden from all-views holders on this product (`identity.surface.hiddenAdminViews`, Halli 2026-09-24: projects hidden for now) — the route stays live and the view grantable.

**Rules**
- Slug folding applies on GENERATION only; stored slugs never change.
- The board's gate is the `projects` view OR editor (admin/moderator), in both `router.js` and `AdminProjectsView.js`; the API's writes keep their own admin/moderator gate.
- Full rules: [../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio](../docs/ARCHITECTURE.md#12-news-projects-party-bio-hidden-portfolio).
