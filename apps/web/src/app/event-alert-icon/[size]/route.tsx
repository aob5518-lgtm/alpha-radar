import { ImageResponse } from "next/og";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const value = (await params).size;
  if (value !== "192" && value !== "512")
    return new Response(null, { status: 404 });
  const size = Number(value);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#101418",
          color: "#34d399",
          fontWeight: 700,
          fontSize: size * 0.38,
        }}
      >
        AR
      </div>
    ),
    {
      width: size,
      height: size,
      headers: { "Cache-Control": "public, max-age=86400" },
    },
  );
}
