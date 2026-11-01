import { z } from "zod";

// Shape the LLM must return. Keys match the PRD: title, script_text, visual_keywords.
export const scriptSchema = z.object({
  title: z.string().trim().min(5).max(100),
  script_text: z.string().trim().min(300).max(1500),
  visual_keywords: z.array(z.string().trim().min(2).max(40)).min(3).max(8),
});

export type ScriptOutput = z.infer<typeof scriptSchema>;