const Project = require('../models/Project');

const projectController = {
  async getAll(req, res, next) {
    try {
      const { category, featured, year, limit, offset } = req.query;
      res.json(await Project.findAll({ category, featured, year, limit, offset }));
    } catch (err) { next(err); }
  },

  async getFeatured(req, res, next) {
    try {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
      res.json(await Project.findFeatured());
    } catch (err) { next(err); }
  },

  async getOne(req, res, next) {
    try {
      const project = await Project.findById(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found', code: 404 });
      res.json(project);
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      res.status(201).json(await Project.create(req.body));
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      const project = await Project.update(req.params.id, req.body);
      if (!project) return res.status(404).json({ error: 'Project not found', code: 404 });
      res.json(project);
    } catch (err) { next(err); }
  },

  async remove(req, res, next) {
    try {
      const deleted = await Project.delete(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Project not found', code: 404 });
      res.status(204).send();
    } catch (err) { next(err); }
  },
};

module.exports = projectController;
