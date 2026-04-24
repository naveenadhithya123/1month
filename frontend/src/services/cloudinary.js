export function transformCloudinaryUrl(url, transformation = "f_auto,q_auto") {
  if (!url || !url.includes("/upload/")) {
    return url;
  }

  return url.replace("/upload/", `/upload/${transformation}/`);
}
