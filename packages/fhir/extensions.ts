import type { Extension } from '@medplum/fhirtypes';

export function stringExtension(url: string, value: string): Extension {
  return { url, valueString: value };
}

export function getStringExtension(extensions: Extension[] | undefined, url: string): string | undefined {
  return extensions?.find((extension) => extension.url === url)?.valueString;
}
