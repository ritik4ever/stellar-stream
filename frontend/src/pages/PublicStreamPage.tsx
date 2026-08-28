import { Navigate, useNavigate, useParams } from "react-router-dom";
import { StreamDetailDrawer } from "../components/StreamDetailDrawer";

export function PublicStreamPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const navigate = useNavigate();

  if (!streamId) {
    return <Navigate to="/" replace />;
  }

  return <StreamDetailDrawer streamId={streamId} onClose={() => navigate("/")} />;
}
