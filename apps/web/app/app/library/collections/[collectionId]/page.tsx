import { notFound } from "next/navigation";
import { CollectionDetailPage } from "../../../../../components/application/ProductPages";
import { AuthError } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { getCollectionDetail } from "../../../../../lib/library/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ collectionId: string }> };

export default async function CollectionDetailRoute({ params }: Props) {
  const session = await requireCompletedSession();
  const { collectionId } = await params;
  try {
    return <CollectionDetailPage collection={await getCollectionDetail(session.user.id, collectionId)} />;
  } catch (error) {
    if (error instanceof AuthError && error.status === 404) notFound();
    throw error;
  }
}
