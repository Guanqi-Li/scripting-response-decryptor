import { Button, Divider, HStack, LazyVStack, ScrollView, Text, VStack } from "scripting"
import { ComicCover, type CoverCache } from "./ComicGrid"
import type { Comic } from "./catalog"
import { chapterLabel, type ReadingRecord } from "./reading-history"

export function ReadingHistoryView({ records, error, retry, covers, openBook }: {
  records: ReadingRecord[]
  error: string
  retry: () => void
  covers: CoverCache
  openBook: (book: Comic) => void
}) {
  return (
    <ScrollView>
      <LazyVStack alignment="leading" spacing={0} padding={{ horizontal: 16, bottom: 80 }}>
        {error ? <VStack alignment="leading" spacing={6}>
          <Text>{error}</Text><Button title="重试" action={retry} />
        </VStack> : !records.length ? <Text foregroundStyle="secondaryLabel">暂无观看历史</Text> : null}
        {records.map((record, index) => (
          <VStack key={record.book.bookID} alignment="leading" spacing={0}>
            <Button buttonStyle="plain" action={() => openBook(record.book)}>
              <HStack spacing={12} padding={{ vertical: 10 }} contentShape="rect">
                <ComicCover url={record.book.coverURL} covers={covers} width={50} />
                <VStack alignment="leading" spacing={5} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                  <Text fontWeight="semibold">{record.book.title}</Text>
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    {`${chapterLabel(record.chapter)} · 第 ${record.page}/${record.pageCount} 张`}
                  </Text>
                </VStack>
              </HStack>
            </Button>
            {index < records.length - 1 ? <Divider /> : null}
          </VStack>
        ))}
      </LazyVStack>
    </ScrollView>
  )
}
