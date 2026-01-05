const { URL } = require("url");

const organizationId = core.getInput("organization_id");
const serviceName = core.getInput("service_name");

const endpoints = [];

for (const u of urls) {
  try {
    const parsed = new URL(u);

    endpoints.push({
      organization_id: organizationId,
      service_name: serviceName,
      method: "GET",
      path: parsed.pathname,
      normalized_path: parsed.pathname,
      host: parsed.hostname,
      scheme: parsed.protocol.replace(":", ""),
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

if (endpoints.length === 0) {
  core.info("No valid endpoints extracted");
  return;
}

await axios.post(endpoint, endpoints, {
  headers: {
    "Content-Type": "application/json"
  }
});
