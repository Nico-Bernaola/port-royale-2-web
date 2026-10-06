"""DXT1/3/5 block decoders (numpy) producing RGBA uint8 arrays."""
import numpy as np


def _565(c):
    r = ((c >> 11) & 31).astype(np.uint32)
    g = ((c >> 5) & 63).astype(np.uint32)
    b = (c & 31).astype(np.uint32)
    return np.stack([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)], -1)


def _color_blocks(blk, force_four=False):
    """blk: (N, 8) uint8 color sub-blocks -> (N, 16, 4) RGBA."""
    c0 = blk[:, 0].astype(np.uint16) | (blk[:, 1].astype(np.uint16) << 8)
    c1 = blk[:, 2].astype(np.uint16) | (blk[:, 3].astype(np.uint16) << 8)
    idx = blk[:, 4].astype(np.uint32) | (blk[:, 5].astype(np.uint32) << 8) | \
        (blk[:, 6].astype(np.uint32) << 16) | (blk[:, 7].astype(np.uint32) << 24)
    p0 = _565(c0).astype(np.int32)
    p1 = _565(c1).astype(np.int32)
    four = (c0 > c1) | force_four
    p2 = np.where(four[:, None], (2 * p0 + p1) // 3, (p0 + p1) // 2)
    p3 = np.where(four[:, None], (p0 + 2 * p1) // 3, 0)
    pal = np.stack([p0, p1, p2, p3], 1)  # N,4,3
    alpha = np.full((len(blk), 4), 255, np.int32)
    alpha[:, 3] = np.where(four, 255, 0)
    sel = np.stack([(idx >> (2 * i)) & 3 for i in range(16)], 1)  # N,16
    rgb = np.take_along_axis(pal, sel[:, :, None].repeat(3, 2), 1)
    a = np.take_along_axis(alpha, sel, 1)
    return np.concatenate([rgb, a[:, :, None]], 2).astype(np.uint8)


def _assemble(px, w, h):
    bw, bh = (w + 3) // 4, (h + 3) // 4
    img = px.reshape(bh, bw, 4, 4, 4).transpose(0, 2, 1, 3, 4).reshape(bh * 4, bw * 4, 4)
    return img[:h, :w]


def dxt1(data, w, h):
    n = ((w + 3) // 4) * ((h + 3) // 4)
    blk = np.frombuffer(data, np.uint8, n * 8).reshape(n, 8)
    return _assemble(_color_blocks(blk), w, h)


def dxt3(data, w, h):
    n = ((w + 3) // 4) * ((h + 3) // 4)
    blk = np.frombuffer(data, np.uint8, n * 16).reshape(n, 16)
    px = _color_blocks(blk[:, 8:], True)
    a = blk[:, :8]
    nib = np.stack([(a[:, i // 2] >> (4 * (i % 2))) & 15 for i in range(16)], 1)
    px[:, :, 3] = (nib * 17).astype(np.uint8)
    return _assemble(px, w, h)


def dxt5(data, w, h):
    n = ((w + 3) // 4) * ((h + 3) // 4)
    blk = np.frombuffer(data, np.uint8, n * 16).reshape(n, 16)
    px = _color_blocks(blk[:, 8:], True)
    a0 = blk[:, 0].astype(np.int32)
    a1 = blk[:, 1].astype(np.int32)
    bits = np.zeros(n, np.uint64)
    for i in range(6):
        bits |= blk[:, 2 + i].astype(np.uint64) << np.uint64(8 * i)
    sel = np.stack([((bits >> np.uint64(3 * i)) & np.uint64(7)).astype(np.int32) for i in range(16)], 1)
    pal = np.zeros((n, 8), np.int32)
    pal[:, 0], pal[:, 1] = a0, a1
    big = a0 > a1
    for i in range(1, 7):
        pal[:, i + 1] = np.where(big, ((7 - i) * a0 + i * a1) // 7, 0)
    for i in range(1, 5):
        pal[:, i + 1] = np.where(big, pal[:, i + 1], ((5 - i) * a0 + i * a1) // 5)
    pal[:, 6] = np.where(big, pal[:, 6], 0)
    pal[:, 7] = np.where(big, pal[:, 7], 255)
    px[:, :, 3] = np.take_along_axis(pal, sel, 1).astype(np.uint8)
    return _assemble(px, w, h)
