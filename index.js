const core = require("@actions/core");
const fg = require("fast-glob");
const fs = require("fs");
const axios = require("axios");
const YAML = require("yaml");
const { URL } = require("url");

(async () => {
  try {
    const endpoint = core.getInput("endpoint");
    const organizationId = core.getInput("organization_id");
    const serviceName = core.getInput("service_name");

    const files = await fg(["**/*.yaml", "**/*.yml"], {
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"]
    });

    const endpoints = [];

    for (const file of files) {
      let raw;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }

      let spec;
      try {
        spec = YAML.parse(raw);
      } catch {
        continue;
      }

      // Not an OpenAPI spec
      if (!spec || !spec.openapi || !spec.paths) continue;

      // Pick first server, fallback safe
      let baseUrl = "http://localhost";
      if (Array.isArray(spec.servers) && spec.servers.length > 0) {
        baseUrl = spec.servers[0].url;
      }

      let parsedBase;
      try {
        parsedBase = new URL(baseUrl);
      } catch {
        parsedBase = new URL("http://localhost");
      }

      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          if (!["get", "post", "put", "delete", "patch", "head", "options"].includes(method)) {
            continue;
          }

          endpoints.push({
            organization_id: organizationId,
            service_name: serviceName,

            method: method.toUpperCase(),
            path,
            normalized_path: path.replace(/{[^}]+}/g, ":param"),

            host: parsedBase.hostname,
            scheme: parsedBase.protocol.replace(":", ""),
            version: spec.info?.version ?? null,

            discovered_by: "github_cicd_plugin_openapi",

            status_code_sample: null,
            auth_required: Boolean(
              operation.security || spec.security
            ),

            sensitive: null,
            request_schema: operation.requestBody ?? null,
            response_schema: operation.responses ?? null,
            headers_sample: null,
            tags: operation.tags ?? []
          });
        }
      }
    }

    if (endpoints.length === 0) {
      core.info("No OpenAPI endpoints found");
      return;
    }

    await axios.post(endpoint, endpoints, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    core.info(`Sent ${endpoints.length} OpenAPI endpoints`);
  } catch (err) {
    core.setFailed(err.message);
  }
})();

