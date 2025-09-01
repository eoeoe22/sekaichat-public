import { logError, logDebug, verifyJwt } from './utils.js';

// 사용자 인증 확인 함수
async function getUserFromRequest(request, env) {
  try {
    const cookies = request.headers.get('Cookie');
    if (!cookies) return null;
    
    const tokenMatch = cookies.match(/token=([^;]+)/);
    if (!tokenMatch) return null;
    
    const token = tokenMatch[1];
    const tokenData = await verifyJwt(token, env);
    if (!tokenData) return null;
    
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?')
      .bind(tokenData.userId).first();
    
    return user;
  } catch (error) {
    await logError(error, env, 'Knowledge Base: GetUserFromRequest');
    return null;
  }
}

// 지식 베이스 관리 핸들러
export const handleKnowledgeBase = {
  // 모든 지식 베이스 조회
  async getAll(request, env) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('인증이 필요합니다', { status: 401 });
      }
      
      const { results } = await env.DB.prepare(
        'SELECT * FROM knowledge_base ORDER BY created_at DESC'
      ).all();
      
      return new Response(JSON.stringify(results || []), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Knowledge Base: GetAll');
      return new Response('지식 베이스 조회 오류', { status: 500 });
    }
  },

  // Knowledge base creation, update, and deletion methods removed for read-only access

  // 키워드 기반 지식 검색
  async searchByKeywords(request, env, conversationId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('인증이 필요합니다', { status: 401 });
      }
      
      const { message } = await request.json();
      if (!message) {
        return new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 현재 대화에 이미 적용된 지식 조회
      const conversation = await env.DB.prepare(
        'SELECT knowledge_ids FROM conversations WHERE id = ? AND user_id = ?'
      ).bind(conversationId, user.id).first();
      
      const appliedKnowledgeIds = conversation?.knowledge_ids ? 
        JSON.parse(conversation.knowledge_ids) : [];
      
      // 모든 지식 베이스 조회
      const { results: allKnowledge } = await env.DB.prepare(
        'SELECT * FROM knowledge_base'
      ).all();
      
      // 키워드 매칭 로직
      const matchedKnowledge = allKnowledge.filter(knowledge => {
        // 이미 적용된 지식은 제외
        if (appliedKnowledgeIds.includes(knowledge.id)) {
          return false;
        }
        
        const keywords = knowledge.keywords.toLowerCase().split(',').map(k => k.trim());
        const messageLower = message.toLowerCase();
        
        return keywords.some(keyword => messageLower.includes(keyword));
      });
      
      return new Response(JSON.stringify(matchedKnowledge), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Knowledge Base: SearchByKeywords');
      return new Response('키워드 검색 오류', { status: 500 });
    }
  }
};

// 대화별 지식 관리 핸들러
export const handleConversationKnowledge = {
  // 대화에 지식 적용
  async apply(request, env, conversationId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('인증이 필요합니다', { status: 401 });
      }
      
      const { knowledgeId } = await request.json();
      if (!knowledgeId) {
        return new Response('지식 ID가 필요합니다', { status: 400 });
      }
      
      // 현재 적용된 지식 목록 조회
      const conversation = await env.DB.prepare(
        'SELECT knowledge_ids FROM conversations WHERE id = ? AND user_id = ?'
      ).bind(conversationId, user.id).first();
      
      if (!conversation) {
        return new Response('대화를 찾을 수 없습니다', { status: 404 });
      }
      
      const currentKnowledgeIds = conversation.knowledge_ids ? 
        JSON.parse(conversation.knowledge_ids) : [];
      
      // 이미 적용된 지식인지 확인
      if (currentKnowledgeIds.includes(knowledgeId)) {
        return new Response('이미 적용된 지식입니다', { status: 400 });
      }
      
      // 지식 추가
      currentKnowledgeIds.push(knowledgeId);
      
      await env.DB.prepare(
        'UPDATE conversations SET knowledge_ids = ? WHERE id = ? AND user_id = ?'
      ).bind(JSON.stringify(currentKnowledgeIds), conversationId, user.id).run();
      
      return new Response(JSON.stringify({ success: true, knowledgeIds: currentKnowledgeIds }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Conversation Knowledge: Apply');
      return new Response('지식 적용 오류', { status: 500 });
    }
  },

  // 대화에서 지식 제거
  async remove(request, env, conversationId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('인증이 필요합니다', { status: 401 });
      }
      
      const { knowledgeId } = await request.json();
      if (!knowledgeId) {
        return new Response('지식 ID가 필요합니다', { status: 400 });
      }
      
      // 현재 적용된 지식 목록 조회
      const conversation = await env.DB.prepare(
        'SELECT knowledge_ids FROM conversations WHERE id = ? AND user_id = ?'
      ).bind(conversationId, user.id).first();
      
      if (!conversation) {
        return new Response('대화를 찾을 수 없습니다', { status: 404 });
      }
      
      const currentKnowledgeIds = conversation.knowledge_ids ? 
        JSON.parse(conversation.knowledge_ids) : [];
      
      // 지식 제거
      const updatedKnowledgeIds = currentKnowledgeIds.filter(id => id !== knowledgeId);
      
      await env.DB.prepare(
        'UPDATE conversations SET knowledge_ids = ? WHERE id = ? AND user_id = ?'
      ).bind(JSON.stringify(updatedKnowledgeIds), conversationId, user.id).run();
      
      return new Response(JSON.stringify({ success: true, knowledgeIds: updatedKnowledgeIds }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Conversation Knowledge: Remove');
      return new Response('지식 제거 오류', { status: 500 });
    }
  },

  // 대화에 적용된 지식 목록 조회
  async getApplied(request, env, conversationId) {
    try {
      const user = await getUserFromRequest(request, env);
      if (!user) {
        return new Response('인증이 필요합니다', { status: 401 });
      }
      
      // 대화의 적용된 지식 ID 조회
      const conversation = await env.DB.prepare(
        'SELECT knowledge_ids FROM conversations WHERE id = ? AND user_id = ?'
      ).bind(conversationId, user.id).first();
      
      if (!conversation) {
        return new Response('대화를 찾을 수 없습니다', { status: 404 });
      }
      
      const knowledgeIds = conversation.knowledge_ids ? 
        JSON.parse(conversation.knowledge_ids) : [];
      
      if (knowledgeIds.length === 0) {
        return new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // 지식 상세 정보 조회
      const placeholders = knowledgeIds.map(() => '?').join(',');
      const { results: appliedKnowledge } = await env.DB.prepare(
        `SELECT * FROM knowledge_base WHERE id IN (${placeholders}) ORDER BY created_at DESC`
      ).bind(...knowledgeIds).all();
      
      return new Response(JSON.stringify(appliedKnowledge || []), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      await logError(error, env, 'Conversation Knowledge: GetApplied');
      return new Response('적용된 지식 조회 오류', { status: 500 });
    }
  }
};