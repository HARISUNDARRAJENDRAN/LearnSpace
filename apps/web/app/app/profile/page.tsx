import { ProfilePage } from "../../../components/profile/ProfilePage";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { getLearnerProfile } from "../../../lib/profile/service";

export const dynamic = "force-dynamic";

export default async function ProfileRoute() {
  const session = await requireCompletedSession();
  const { displayName, email, createdAt } = session.user;
  return <ProfilePage user={{ displayName, email, createdAt: createdAt.toISOString() }} profile={await getLearnerProfile(session.user.id)} />;
}
