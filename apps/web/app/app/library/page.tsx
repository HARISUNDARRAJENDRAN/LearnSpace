import type { Metadata } from "next";
import { LibraryPage } from "../../../components/application/ProductPages";
import { requireCompletedSession } from "../../../lib/discovery/access";
import { getLibraryPage } from "../../../lib/library/service";

export const metadata: Metadata = { title: "Library | LearnSpace" };

export const dynamic = "force-dynamic";

export default async function LibraryRoute() {
  const session = await requireCompletedSession();
  return <LibraryPage data={await getLibraryPage(session.user.id)} />;
}
