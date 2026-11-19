'use client';

import { useParams } from 'next/navigation';
import BlogEditor from '../_components/BlogEditor';

export default function EditBlogPostPage() {
  const params = useParams();
  const id = params?.id as string;
  return <BlogEditor key={id} postId={id} />;
}
