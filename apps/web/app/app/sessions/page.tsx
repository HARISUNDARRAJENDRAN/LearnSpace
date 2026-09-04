import { SessionsPage } from "../../../components/application/ProductPages";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { listStudySessions } from "../../../lib/study/service";

export const dynamic = "force-dynamic";

export default async function SessionsRoute() {
  const session = await requireCompletedSession();
  return <SessionsPage sessions={await listStudySessions(session.user.id)} />;
}
