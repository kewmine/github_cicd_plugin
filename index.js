const core = require("@actions/core");
const fg = require("fast-glob");
const fs = require("fs");
const axios = require("axios");
const YAML = require("yaml");
const { URL } = require("url");

// Regex for extracting URLs
// Matches http:// or https:// followed by non-whitespace/quote chars.
// We can refine this to be more precise if needed.
const URL_REGEX = /https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?(?:[\/a-zA-Z0-9._~:?#@!$&'()*+,;=%-]*)?/g;

(async () => {
  try {
    const backendEndpoint = core.getInput("endpoint");
    const organizationId = core.getInput("organization_id");
    // const serviceNameInput = core.getInput("service_name"); // User requested specific names, ignoring input for these

    // 1. Scan everything (respecting gitignore if possible, or manual ignores)
    // We want to find OpenAPI specs (yaml/json) AND source code for URLs.
    const files = await fg(["**/*"], {
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/*.png", "**/*.jpg", "**/*.jpeg", "**/*.gif", "**/*.svg", "**/*.ico",
        "**/*.woff", "**/*.woff2", "**/*.ttf", "**/*.eot",
        "**/*.zip", "**/*.tar", "**/*.gz", "**/*.7z", "**/*.rar",
        "**/*.pdf", "**/*.exe", "**/*.dll", "**/*.so", "**/*.dylib", "**/*.bin"
      ],
      dot: true
    });

    const endpoints = [];

    // Helper to add endpoint
    const addEndpoint = (data) => {
      // Basic validation or deduplication could happen here
      endpoints.push(data);
    };

    for (const file of files) {
      let raw;
      try {
        // Limit file size read (e.g. 5MB) to avoid OOM on huge files? 
        // For now, read full.
        const stats = fs.statSync(file);
        if (stats.size > 5 * 1024 * 1024) continue; // Skip large files > 5MB

        raw = fs.readFileSync(file, "utf8");
      } catch (e) {
        // Binary file read error or permission error
        continue;
      }

      // Check if OpenAPI
      let isOpenApi = false;
      if (file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json")) {
        let spec;
        try {
          if (file.endsWith(".json")) {
            spec = JSON.parse(raw);
          } else {
            spec = YAML.parse(raw);
          }
        } catch (e) {
          // Not valid YAML/JSON
        }

        if (spec && spec.openapi && spec.paths) {
          isOpenApi = true;
          // Process as OpenAPI with service name 'github-cicd-openapi'
          processOpenApi(spec, organizationId, "github-cicd-openapi", addEndpoint);
        }
      }

      // If NOT OpenAPI, scan for URLs
      if (!isOpenApi) {
        // Process as generic source with service name 'github-cicd-urls'
        processUrlScan(raw, organizationId, "github-cicd-urls", addEndpoint);
      }
    }

    if (endpoints.length === 0) {
      core.info("No endpoints found.");
      return;
    }

    // Send data
    core.info(`Found ${endpoints.length} endpoints. Sending to ${backendEndpoint}...`);
    // Post in batches? The original code posted all at once. We'll stick to that.

    await axios.post(backendEndpoint, endpoints, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    core.info(`Successfully sent ${endpoints.length} endpoints to Warus.`);
  } catch (err) {
    core.setFailed(err.message);
  }
})();

function processOpenApi(spec, orgId, serviceName, addFn) {
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
      // Filter valid methods
      if (!["get", "post", "put", "delete", "patch", "head", "options"].includes(method.toLowerCase())) {
        continue;
      }

      addFn({
        organization_id: orgId,
        service_name: serviceName,

        method: method.toUpperCase(),
        path,
        normalized_path: path.replace(/{[^}]+}/g, ":param"),

        host: parsedBase.hostname,
        scheme: parsedBase.protocol.replace(":", ""),
        version: spec.info?.version ?? null,

        discovered_by: "github_cicd_plugin_openapi",

        status_code_sample: null,
        auth_required: Boolean(operation.security || spec.security),
        sensitive: false, // Default

        request_schema: operation.requestBody ?? null,
        response_schema: operation.responses ?? null,
        headers_sample: null,
        tags: operation.tags ?? []
      });
    }
  }
}

function processUrlScan(content, orgId, serviceName, addFn) {
  const matches = content.match(URL_REGEX);
  if (!matches) return;

  // Deduplicate within file
  const uniqueUrls = new Set(matches);

  for (const urlStr of uniqueUrls) {
    try {
      const url = new URL(urlStr);
      // Filter out non-http/https
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

      // Avoid localhost/127.0.0.1 in scanned URLs? Maybe user wants them? 
      // User said "any and all urls". Keeping them.

      addFn({
        organization_id: orgId,
        service_name: serviceName,

        method: "GET", // Default
        path: url.pathname === "" ? "/" : url.pathname,
        normalized_path: url.pathname === "" ? "/" : url.pathname,

        host: url.hostname,
        scheme: url.protocol.replace(":", ""),
        version: null,

        discovered_by: "github_cicd_plugin_url_scan",

        status_code_sample: null,
        auth_required: null,
        sensitive: false,

        request_schema: null,
        response_schema: null,
        headers_sample: null,
        tags: ["url_scan"]
      });
    } catch (e) {
      // Invalid URL
    }
  }
}
