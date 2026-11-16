import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.notifications";
import { db } from "~/db";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { markRead } from "~/lib/comments.server";

// Notification actions. Submitting here revalidates the layout.app loader, so
// the bell's badge updates with no extra request. Add new intents as members
// of the union and cases in the switch.
const notificationActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("mark-read"),
    notificationId: z.coerce.number().int().positive(),
  }),
]);

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, notificationActionSchema);
  if (!parsed.success) {
    throw data("Invalid action", { status: 400 });
  }

  const submission = parsed.data;
  switch (submission.intent) {
    case "mark-read": {
      const href = markRead(db, currentUserId, submission.notificationId);
      if (!href) {
        throw data("Notification not found", { status: 404 });
      }
      return redirect(href);
    }
  }
}
