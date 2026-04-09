/*
 * Minimal ZIP reader for pre-generated upstream archives. This supports the
 * stored and deflate methods used by the SamacSys KiCad download bundle.
 */

function findEndOfCentralDirectory(bytes) {
  const minimumOffset = Math.max(0, bytes.length - 0xffff - 22);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("ZIP end of central directory record was not found.");
}

async function inflateRaw(compressedBytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("ZIP deflate decompression is not available in this runtime.");
  }

  const stream = new Blob([compressedBytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function readZipEntry(bytes, view, metadata) {
  const localHeaderOffset = metadata.localHeaderOffset;
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error(`ZIP local header is invalid for ${metadata.name}.`);
  }

  const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraFieldLength = view.getUint16(localHeaderOffset + 28, true);
  const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
  const compressedBytes = bytes.subarray(
    dataOffset,
    dataOffset + metadata.compressedSize
  );

  if (metadata.compressionMethod === 0) {
    return {
      name: metadata.name,
      data: new Uint8Array(compressedBytes)
    };
  }

  if (metadata.compressionMethod === 8) {
    return {
      name: metadata.name,
      data: await inflateRaw(compressedBytes)
    };
  }

  throw new Error(
    `ZIP compression method ${metadata.compressionMethod} is not supported for ${metadata.name}.`
  );
}

export async function readZipEntries(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder();
  const metadata = [];

  let offset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("ZIP central directory record is invalid.");
    }

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const name = decoder.decode(bytes.subarray(fileNameStart, fileNameEnd));

    metadata.push({
      name,
      compressionMethod,
      compressedSize,
      localHeaderOffset
    });

    offset = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return Promise.all(metadata.map((entry) => readZipEntry(bytes, view, entry)));
}
/*
######################################################################################################################


                                        AAAAAAAA
                                      AAAA    AAAAA              AAAAAAAA
                                    AAA          AAA           AAAA    AAA
                                    AA            AA          AAA       AAA
                                    AA            AAAAAAAAAA  AAA       AAAAAAAAAA
                                    AAA                  AAA  AAA               AA
                                     AAA                AAA    AAAAA            AA
                                      AAAAA            AAA        AAA           AA
                                         AAA          AAA                       AA
                                         AAA         AAA                        AA
                                         AA         AAA                         AA
                                         AA        AAA                          AA
                                        AAA       AAAAAAAAA                     AA
                                        AAA       AAAAAAAAA                     AA
                                        AA                   AAAAAAAAAAAAAA     AA
                                        AA  AAAAAAAAAAAAAAAAAAAAAAAA    AAAAAAA AA
                                       AAAAAAAAAAA                           AA AA
                                                                           AAA  AA
                                                                         AAAA   AA
                                                                      AAAA      AA
                                                                   AAAAA        AA
                                                               AAAAA            AA
                                                            AAAAA               AA
                                                        AAAAAA                  AA
                                                    AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA


######################################################################################################################

                                                Copyright (c) JoeShade
                              Licensed under the GNU Affero General Public License v3.0

######################################################################################################################

                                        +44 (0) 7356 042702 | joe@jshade.co.uk

######################################################################################################################
*/
