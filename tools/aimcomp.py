"""Ascaron AIM slice (de)compression, ported from AIM20.dll (function at 0x1008491c).

Blob layout (after a leading 0x01 marker byte):
  u32 out_size
  u32 flags      bit31 = stored; bit30 (with bit31) = bytes XOR 0x35
  u32 params     8 nibbles: incremental bit widths for the 8 LZ offset classes
  ...            bitstream of little-endian u32 words, consumed LSB first

Token: 1 flag bit. 0 -> literal (8 bits). 1 -> match:
  3 bits class c, then width[c] bits v; distance = base[c] + v (copy from out[pos - distance - 1])
  length = 2 + sum of fields of width 2,3,4,... read while a field is all ones.
"""
import struct


class BitReader:
    __slots__ = ('data', 'pos', 'acc', 'n')

    def __init__(self, data, pos):
        self.data, self.pos, self.acc, self.n = data, pos, 0, 0

    def read(self, k):
        while self.n < k:
            if self.pos + 4 <= len(self.data):
                w = struct.unpack_from('<I', self.data, self.pos)[0]
            else:
                w = int.from_bytes(self.data[self.pos:self.pos + 4].ljust(4, b'\0'), 'little')
            self.pos += 4
            self.acc |= w << self.n
            self.n += 32
        v = self.acc & ((1 << k) - 1)
        self.acc >>= k
        self.n -= k
        return v


def decompress(blob, offset=0):
    """blob[offset] must be 0x01. Returns decoded bytes."""
    if blob[offset] != 1:
        raise ValueError('bad slice marker %r' % blob[offset])
    p = offset + 1
    size, flags, params = struct.unpack_from('<iII', blob, p)
    size = abs(size)
    p += 12
    if flags & 0x80000000:
        raw = blob[p:p + size]
        if flags & 0x40000000:
            raw = bytes(b ^ 0x35 for b in raw)
        return bytes(raw)
    widths, bases, cum, base = [], [], 0, 0
    for i in range(8):
        cum += params & 15
        params >>= 4
        if i:
            base += (1 << widths[-1])
        widths.append(cum)
        bases.append(base)
    out = bytearray()
    br = BitReader(blob, p)
    while len(out) < size:
        if br.read(1) == 0:
            out.append(br.read(8))
        else:
            c = br.read(3)
            dist = bases[c] + br.read(widths[c])
            length, w = 2, 2
            while True:
                t = br.read(w)
                length += t
                if t != (1 << w) - 1:
                    break
                w += 1
            src = len(out) - dist - 1
            for i in range(length):
                out.append(out[src + i])
    return bytes(out[:size])
