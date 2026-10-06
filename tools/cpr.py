"""Ascaron archive (.cpr, 'ASCARON_ARCHIVE V0.9') reader/extractor.

Layout: 0x20-byte magic header, then a linked list of directory blocks.
Each block: u32 block_size, u32 used_bytes, u32 entry_count, u32 data_length,
followed by entries of u32 offset, u32 size, u32 flag, NUL-terminated latin-1 name.
The block's file data follows it; the next directory block starts right after that
data (block_start + block_size + data_length). File data is stored uncompressed.
"""
import struct
import sys
import os

BS = chr(92)


def entries(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:15] == b'ASCARON_ARCHIVE', 'not an ascaron archive'
    pos = 0x20
    out = []
    while pos + 16 <= len(data):
        blk, _used, count, data_len = struct.unpack_from('<IIII', data, pos)
        nxt = pos + blk + data_len
        p = pos + 16
        for _ in range(count):
            off, size, flag = struct.unpack_from('<III', data, p)
            p += 12
            end = data.index(b'\0', p)
            name = data[p:end].decode('latin-1').replace(BS, '/')
            p = end + 1
            out.append((name, off, size, flag))
        pos = nxt
    return data, out


if __name__ == '__main__':
    arc = sys.argv[1]
    data, ents = entries(arc)
    if len(sys.argv) > 2:
        dest = sys.argv[2]
        for name, off, size, _flag in ents:
            fn = os.path.join(dest, name)
            os.makedirs(os.path.dirname(fn) or '.', exist_ok=True)
            with open(fn, 'wb') as o:
                o.write(data[off:off + size])
        print(f'extracted {len(ents)} files from {arc}')
    else:
        for e in ents:
            print(e[0], e[2], e[3])
