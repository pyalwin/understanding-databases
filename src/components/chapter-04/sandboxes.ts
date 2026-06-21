// Python (Pyodide) sandbox source for Chapter 04, §1–§3.
//
// Each constant is a SELF-CONTAINED Python program. Pyodide runs one shared
// runtime per page, so a later sandbox must NOT depend on classes defined in an
// earlier one — every string re-declares what it needs and runs clean on its
// own. Pass these to <PythonSandbox initialCode={...} client:visible />.

/**
 * §1 — The Page.
 * A 4 KB page backed by a fixed-size bytearray, with a slot directory growing
 * down from the header and row data growing up from the bottom. Inserts rows
 * until the page rejects one, proving a page is finite.
 */
export const PAGE_SANDBOX = `# A single 4 KB page: a slot directory at the top, row bytes at the bottom.
PAGE_SIZE = 4096
HEADER    = 8   # bytes reserved for the page header
SLOT_SIZE = 4   # each slot records one row's (offset, length)

class PageFull(Exception):
    pass

class Page:
    def __init__(self):
        self.buf      = bytearray(PAGE_SIZE)
        self.slots    = []         # the slot directory: (offset, length) per row
        self.free_end = PAGE_SIZE  # row data grows DOWN from the bottom

    def free_space(self):
        # directory grows down from the header; rows grow up from free_end.
        dir_end = HEADER + (len(self.slots) + 1) * SLOT_SIZE
        return self.free_end - dir_end

    def insert(self, row):
        if self.free_space() < len(row):
            raise PageFull("need %d bytes, only %d free" % (len(row), self.free_space()))
        self.free_end -= len(row)
        self.buf[self.free_end:self.free_end + len(row)] = row
        self.slots.append((self.free_end, len(row)))
        return len(self.slots) - 1          # the new slot number

    def read(self, slot):
        off, length = self.slots[slot]
        if length == 0:
            return None                     # tombstoned: row was deleted
        return bytes(self.buf[off:off + length])

    def delete(self, slot):
        off, _ = self.slots[slot]
        self.slots[slot] = (off, 0)         # leave the slot, zero its length

# Insert fixed-size rows until the page refuses one.
page = Page()
row  = b"x" * 200
n    = 0
try:
    while True:
        page.insert(row)
        n += 1
except PageFull as e:
    print("inserted %d rows of %d bytes, then: %s" % (n, len(row), e))

print("slot 0 holds:", page.read(0)[:12], "...")
page.delete(0)
print("after delete, slot 0:", page.read(0), "(tombstoned)")
print("free space now:", page.free_space(), "bytes")
`;

/**
 * §2 — The Heap.
 * A heap file is a list of pages; rows append to the last page or spill into a
 * fresh one. A row's physical address is the (page_no, slot) pair. Bulk-insert
 * a few hundred rows and watch the page count climb.
 */
export const HEAP_SANDBOX = `# A heap file = an ordered list of pages. Rows append wherever there is room.
PAGE_SIZE = 4096
HEADER    = 8
SLOT_SIZE = 4

class PageFull(Exception):
    pass

class Page:
    def __init__(self):
        self.buf      = bytearray(PAGE_SIZE)
        self.slots    = []
        self.free_end = PAGE_SIZE

    def free_space(self):
        dir_end = HEADER + (len(self.slots) + 1) * SLOT_SIZE
        return self.free_end - dir_end

    def insert(self, row):
        if self.free_space() < len(row):
            raise PageFull("page is full")
        self.free_end -= len(row)
        self.buf[self.free_end:self.free_end + len(row)] = row
        self.slots.append((self.free_end, len(row)))
        return len(self.slots) - 1

    def read(self, slot):
        off, length = self.slots[slot]
        return bytes(self.buf[off:off + length])

class Heap:
    def __init__(self):
        self.pages = [Page()]

    def insert(self, row):
        try:
            slot = self.pages[-1].insert(row)        # try the last page
        except PageFull:
            self.pages.append(Page())                # else allocate a new one
            slot = self.pages[-1].insert(row)
        return (len(self.pages) - 1, slot)           # (page_no, slot) = row id

    def get(self, page_no, slot):
        return self.pages[page_no].read(slot)

# Append 500 rows and see how many pages that took.
heap = Heap()
addrs = []
for i in range(500):
    row = ("id=%d,name=user%d" % (i, i)).encode()
    addrs.append(heap.insert(row))

print("inserted 500 rows across", len(heap.pages), "pages")
pno, slot = addrs[123]
print("row 123 lives at page %d slot %d ->" % (pno, slot), heap.get(pno, slot))
print("last row address:", addrs[-1])
`;

/**
 * §3 — The Full Scan.
 * With only a heap, answering WHERE id = ? means reading every page and
 * checking every row: O(n) in pages. A hit and a miss cost the same.
 */
export const SCAN_SANDBOX = `# A heap has no order, so a point lookup must read every page. O(n).
PAGE_SIZE = 4096
HEADER    = 8
SLOT_SIZE = 4

class PageFull(Exception):
    pass

class Page:
    def __init__(self):
        self.buf      = bytearray(PAGE_SIZE)
        self.slots    = []
        self.free_end = PAGE_SIZE

    def free_space(self):
        dir_end = HEADER + (len(self.slots) + 1) * SLOT_SIZE
        return self.free_end - dir_end

    def insert(self, row):
        if self.free_space() < len(row):
            raise PageFull("page is full")
        self.free_end -= len(row)
        self.buf[self.free_end:self.free_end + len(row)] = row
        self.slots.append((self.free_end, len(row)))
        return len(self.slots) - 1

    def rows(self):
        for off, length in self.slots:
            yield bytes(self.buf[off:off + length])

class Heap:
    def __init__(self):
        self.pages = [Page()]

    def insert(self, row):
        try:
            self.pages[-1].insert(row)
        except PageFull:
            self.pages.append(Page())
            self.pages[-1].insert(row)

def scan(heap, predicate):
    pages_read = 0
    matches    = []
    for page in heap.pages:            # touch EVERY page...
        pages_read += 1
        for row in page.rows():        # ...and check EVERY row
            if predicate(row):
                matches.append(row)
    return matches, pages_read

# Build a heap of 500 rows, then look one up by id.
heap = Heap()
for i in range(500):
    heap.insert(("id=%d,name=user%d" % (i, i)).encode())

def has_id(target):
    needle = ("id=%d," % target).encode()
    return lambda row: row.startswith(needle)

hits, read = scan(heap, has_id(317))
print("lookup id=317: found %d row(s), read %d of %d pages" % (len(hits), read, len(heap.pages)))

miss, read = scan(heap, has_id(99999))
print("lookup id=99999 (absent): found %d, STILL read %d pages" % (len(miss), read))
print("a miss costs exactly as much as a hit: the whole file.")
`;
