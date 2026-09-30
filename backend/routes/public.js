const express = require("express");
const axios = require("axios");

function createPublicRouter(deps) {
  const { getFeatureConfig, DEFAULT_FEATURE_CONFIG } = deps;
  const router = express.Router();

  // Health check endpoint for Docker/K8s
  router.get("/health", (req, res) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    });
  });

  // Image proxy endpoint to bypass CORS for PDF generator
  router.get("/proxy-image", async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send("Missing url parameter");
    }
    try {
      const response = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 5000,
      });
      const contentType = response.headers["content-type"];
      if (contentType) {
        res.setHeader("content-type", contentType);
      }
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(response.data);
    } catch (e) {
      console.error("[Image Proxy] Error fetching image:", imageUrl, e.message);
      res.status(500).send("Error fetching image");
    }
  });

  // Public feature config (needed by ALL users at boot, no auth required)
  router.get("/admin/config", async (req, res) => {
    try {
      const config = await getFeatureConfig();
      return res.json(config);
    } catch (error) {
      console.error("[Admin Config GET] Error:", error);
      return res.json(DEFAULT_FEATURE_CONFIG);
    }
  });

  return router;
}

module.exports = { createPublicRouter };
