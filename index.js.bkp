const core = require("@actions/core");
const fg = require("fast-glob");
const fs = require("fs");
const axios = require("axios");
const { URL } = require("url");

(async () => {
  try {
    const endpoint = core.getInput("endpoint");
    const organizationId = core.getInput("organization_id");
    const serviceName = core.getInput("service_name");

    const files = await fg("**/*", {
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"]
    });

    const urlRegex = /https?:\/\/[^\s"'<>]+/g;
    const endpoints = [];

    for (const file of files) {
      let content;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }

      const matches = content.match(urlRegex);
      if (!matches) continue;

      for (const raw of matches) {
        try {
          const u = new URL(raw);

          endpoints.push({
            organization_id: organizationId,
            service_name: serviceName,
            method: "GET",
            path: u.pathname,
            normalized_path: u.pathname,
            host: u.hostname,
            scheme: u.protocol.replace(":", ""),
            version: null,
            discovered_by: "github_cicd_plugin",
            status_code_sample: null,
            auth_required: null,
            sensitive: null,
            request_schema: null,
            response_schema: null,
            headers_sample: null,
            tags: []
          });
        } catch {
          // skip invalid URLs
        }
      }
    }

    if (endpoints.length === 0) {
      core.info("No endpoints found");
      return;
    }

    await axios.post(endpoint, endpoints, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    core.info(`Sent ${endpoints.length} endpoints`);
  } catch (err) {
    core.setFailed(err.message);
  }
})();
