import type { FlintApplication, FlintRouteContext } from "@flint/framework";
import { glob, pattern as p } from "@flint/framework";
import sharp from "sharp";
import * as Path from "@std/path";
import * as Fs from "@std/fs";

export type FlintImageMeta = Record<string, {
  height: number;
  width: number;
  src: string;
}>;

export type FlintImageSizes = Record<
  string,
  { height: number } | { width: number }
>;

export default function (
  directory: string,
  sizes: FlintImageSizes,
  type?: "jpeg" | "webp" | "avif",
): ((app: FlintApplication) => void) & {
  list: () => Promise<Array<FlintImageMeta>>;
} {
  const pattern = p`/${directory}/:name*.jpeg`;
  const path = pattern.pathname;
  const ext = Path.extname(path);
  const basename = Path.basename(path, ext);
  const dirname = Path.dirname(path);

  const cb = (app: FlintApplication) => {
    app.route(
      p`${dirname === "/" ? "" : dirname}/${basename}/:size.${
        type ?? ext.slice(1)
      }`,
      ({ params }: FlintRouteContext) => {
        if (
          params.name && params.size &&
          sizes[params.size as keyof typeof sizes] != null
        ) {
          const settings = sizes[params.size as keyof typeof sizes];

          let img = sharp(`./${directory}/${params.name}${ext}`);

          if ("height" in settings || "width" in settings) {
            img = img.resize(settings);
          }

          const method = type ?? ext.slice(1);

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
      ) =>
        Object
          .keys(sizes)
          .map((size) => [
            `/${directory}/${name}/${size}.${type ?? ext.slice(1)}`,
          ])
          .flat()),
    );
  };

  cb.list = async (): Promise<Array<FlintImageMeta>> => {
    const pattern = `./${directory}/**/*.jpeg`;
    const ext = Path.extname(pattern);
    const imagePromises = [];

    for await (let { name, path } of Fs.expandGlob(pattern)) {
      name = Path.basename(name, ext);

      imagePromises.push(
        sharp(path)
          .metadata()
          .then((metadata) => {
            const result: FlintImageMeta = {};

            for (const key of Object.keys(sizes)) {
              const config = sizes[key];
              let height = metadata.height;
              let width = metadata.width;

              if ("height" in config) {
                height = config.height;
                width = metadata.width / metadata.height *
                  config.height;
              }

              if ("width" in config) {
                width = config.width;
                height = metadata.height / metadata.width *
                  config.width;
              }

              result[key] = {
                src: `/${directory}/${name}/${key}.${type}`,
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
