import type { FlintApplication, FlintRouteContext } from "@flint/framework";
import { glob, pattern as p } from "@flint/framework";
import sharp from "sharp";
import * as Path from "@std/path";
import * as Fs from "@std/fs";

type FlintImageExtensions = "jpeg" | "webp" | "avif";

export type FlintImageMeta = Record<string, {
  height: number;
  width: number;
  src: string;
}>;

export type FlintImageSizes = Record<
  string,
  {
    height: number;
    ext?: FlintImageExtensions;
  } | {
    width: number;
    ext?: FlintImageExtensions;
  }
>;

export default function (
  directory: string,
  ext: FlintImageExtensions,
  variants: FlintImageSizes,
): ((app: FlintApplication) => void) & {
  list: () => Promise<Array<FlintImageMeta>>;
} {
  const pattern = p`/${directory}/:name.${ext}`;

  const cb = (app: FlintApplication) => {
    for (const [size, variant] of Object.entries(variants)) {
      app.route(
        p`/${directory}/:name/${size}.${variant.ext ?? ext}`,
        ({ params }: FlintRouteContext) => {
          if (params.name) {
            let img = sharp(
              `${
                Path.join(Deno.cwd(), app.config().src, directory)
              }/${params.name}.${ext}`,
            );

            img = img.resize(variant);

            const method = variant.ext ?? ext;

            if (method === "jpeg" || method === "webp" || method === "avif") {
              img = img[method]({
                quality: 100,
                progressive: true,
                force: true,
              });
            }

            return img.toBuffer() as Promise<Uint8Array<ArrayBuffer>>;
          }

          throw Error("not found");
        },
        glob(pattern, (
          _,
          { name },
        ) => [`/${directory}/${name}/${size}.${variant.ext ?? ext}`]),
      );
    }
  };

  cb.list = async (): Promise<Array<FlintImageMeta>> => {
    const pattern = `./${directory}/**/*.${ext}`;
    const imagePromises = [];

    for await (let { name, path } of Fs.expandGlob(pattern)) {
      name = Path.basename(name, `.${ext}`);

      imagePromises.push(
        sharp(path)
          .metadata()
          .then((metadata) => {
            const result: FlintImageMeta = {};

            for (const [size, variant] of Object.entries(variants)) {
              let height = metadata.height;
              let width = metadata.width;

              if ("height" in variant) {
                height = variant.height;
                width = metadata.width / metadata.height *
                  variant.height;
              }

              if ("width" in variant) {
                width = variant.width;
                height = metadata.height / metadata.width *
                  variant.width;
              }

              result[size] = {
                src: `/${directory}/${name}/${size}.${variant.ext ?? ext}`,
                height,
                width,
              };
            }

            return result;
          }),
      );
    }

    let images: Array<FlintImageMeta> = await Promise.all(imagePromises);
    const orders = new Uint32Array(images.length);

    globalThis.crypto.getRandomValues(orders);

    images = Object.keys(images).sort((a, b) => orders[+a] - orders[+b]).map((
      k,
    ) => images[+k]);

    return images;
  };

  return cb;
}
