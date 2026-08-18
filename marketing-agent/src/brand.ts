import { supabase, isMissingDatabaseObject } from './supabase.js';
import { config } from './config.js';

export type BrandGuide = {
    name: string;
    voice: string;
    banned_topics: string[];
    target_audience: string;
    cta_default: string;
};

const FALLBACK_BRAND: BrandGuide = {
    name: 'OpenMatch',
    voice:
        'Warm, modern, trustworthy, anti-manipulation. OpenMatch is the transparent, AI-first alternative to legacy matrimonial apps (Shaadi/Jeevansathi). No blurred photos, no forced paywalls — free to match & chat, with a small one-time mutual unlock.',
    banned_topics: [
        'caste-based discrimination',
        'religious superiority',
        'dowry',
        'skin-tone / colourism',
        'guaranteed marriage / results',
        'disparaging named competitors',
    ],
    target_audience:
        'Marriage-minded singles (and their families) 24-38 in India + diaspora, frustrated by paywalls and blurred profiles.',
    cta_default: 'Download OpenMatch — free to match & chat.',
};

export async function fetchBrandGuide(): Promise<BrandGuide> {
    const { data, error } = await supabase
        .from('marketing_brand_guide')
        .select('name, voice, banned_topics, target_audience, cta_default')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<BrandGuide>();

    if (error && !isMissingDatabaseObject(error.message)) throw error;

    const brand = data ?? FALLBACK_BRAND;
    // Enrich the CTA with real store links when available.
    const links = [config.playStoreUrl, config.appStoreUrl].filter(Boolean).join(' · ');
    if (links) brand.cta_default = `${brand.cta_default} ${links}`;
    return brand;
}
