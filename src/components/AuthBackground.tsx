import Image from "next/image";
import { IMAGES } from "@/lib/images";

export function AuthBackground() {
  return (
    <div className="absolute inset-0 -z-10">
      <Image
        src={IMAGES.authBg}
        alt=""
        fill
        className="object-cover object-center opacity-30"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-black/85" />
      <div className="absolute inset-0 bg-gradient-to-b from-bull/10 via-transparent to-purple/10" />
    </div>
  );
}
