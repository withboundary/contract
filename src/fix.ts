import type { AttemptDetail, FailureCategory, Message, RepairFn } from "./types.js";

export function fix(
  detail: AttemptDetail,
  repairs?: Partial<Record<FailureCategory, RepairFn | false>>,
): Message[] | false {
  if (repairs) {
    const override = repairs[detail.category];
    if (override === false) {
      return false;
    }
    if (typeof override === "function") {
      return override(detail);
    }
  }

  return defaultRepair(detail);
}

function defaultRepair(detail: AttemptDetail): Message[] {
  switch (detail.category) {
    case "EMPTY_RESPONSE":
      return [
        {
          role: "user",
          content:
            "You returned an empty response. Please respond with a JSON object matching the requested schema.",
        },
      ];

    case "REFUSAL":
      return [
        {
          role: "user",
          content:
            "This is a structured data task. Your response should be a JSON object only, with no refusal or commentary.",
        },
      ];

    case "NO_JSON":
      return [
        {
          role: "user",
          content:
            "Your response contained no JSON. Respond with ONLY a valid JSON object, no explanation, no commentary, no markdown.",
        },
      ];

    case "TRUNCATED":
      return [
        {
          role: "user",
          content:
            "Your previous response was cut off and the JSON is incomplete. Please provide a complete, shorter JSON response.",
        },
      ];

    case "PARSE_ERROR":
      return [
        {
          role: "user",
          content:
            "Your response contained malformed JSON that could not be parsed. Please respond with strictly valid JSON.",
        },
      ];

    case "VALIDATION_ERROR": {
      if (detail.issues.length === 0) {
        return [
          {
            role: "user",
            content:
              "Your previous response did not match the required schema. Please respond with valid JSON matching the schema exactly.",
          },
        ];
      }
      const issueList = detail.issues.map((issue) => `- ${issue}`).join("\n");
      return [
        {
          role: "user",
          content: [
            "Your previous response had validation errors:",
            issueList,
            "Please correct these issues and respond with valid JSON only.",
          ].join("\n"),
        },
      ];
    }

    case "INVARIANT_ERROR": {
      const issueList = detail.issues.map((issue) => `- ${issue}`).join("\n");
      return [
        {
          role: "user",
          content: [
            "Your response had valid types but violated schema constraints:",
            issueList,
            "Please correct these issues and respond with valid JSON only.",
          ].join("\n"),
        },
      ];
    }

    case "RUN_ERROR":
      return [
        {
          role: "user",
          content:
            "The previous attempt encountered an error. Please try again and respond with valid JSON matching the schema.",
        },
      ];

    default:
      return [
        {
          role: "user",
          content:
            "Your previous response could not be processed. Please respond with only valid JSON, no other text.",
        },
      ];
  }
}
